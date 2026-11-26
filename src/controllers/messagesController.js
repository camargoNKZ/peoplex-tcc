const db = require('../config/db');
const { uploadPrivate, signedUrl, removePrivate } = require('../services/storageService');

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function assertMember(companyId, userId, conversationId) {
  const result = await db.query(
    `SELECT c.id, c.type, c.name
       FROM conversations c
       JOIN conversation_members cm
         ON cm.conversation_id = c.id AND cm.company_id = c.company_id
      WHERE c.id = $1 AND c.company_id = $2 AND cm.user_id = $3`,
    [conversationId, companyId, userId]
  );
  return result.rows[0];
}

async function listConversations(req, res) {
  try {
    const result = await db.query(
      `SELECT c.id, c.type, c.name, c.created_at,
              COALESCE(last_message.body, '') AS last_message,
              last_message.created_at AS last_message_at,
              COALESCE(unread.total, 0)::int AS unread_count,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object(
                  'id', u.id, 'name', u.name, 'photo_url', u.photo_url,
                  'job_title', u.job_title
                )) FILTER (WHERE u.id IS NOT NULL), '[]'
              ) AS members
         FROM conversations c
         JOIN conversation_members mine
           ON mine.conversation_id = c.id
          AND mine.company_id = c.company_id
          AND mine.user_id = $2
         LEFT JOIN conversation_members cm
           ON cm.conversation_id = c.id AND cm.company_id = c.company_id
         LEFT JOIN users u
           ON u.id = cm.user_id AND u.company_id = c.company_id AND u.active = true
         LEFT JOIN LATERAL (
           SELECT m.body, m.created_at
             FROM messages m
            WHERE m.conversation_id = c.id AND m.company_id = c.company_id
              AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC LIMIT 1
         ) last_message ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS total
             FROM messages m
            WHERE m.conversation_id = c.id AND m.company_id = c.company_id
              AND m.sender_id <> $2 AND m.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM message_reads mr
                 WHERE mr.message_id = m.id AND mr.company_id = m.company_id
                   AND mr.user_id = $2
              )
         ) unread ON true
        WHERE c.company_id = $1 AND c.archived_at IS NULL
        GROUP BY c.id, last_message.body, last_message.created_at, unread.total
        ORDER BY COALESCE(last_message.created_at, c.created_at) DESC`,
      [req.companyId, req.userId]
    );
    const conversations = await Promise.all(result.rows.map(async conversation => ({
      ...conversation,
      members: await Promise.all((conversation.members || []).map(async member => ({
        ...member,
        photo_url: await signedUrl('avatars', member.photo_url),
      }))),
    })));
    res.json(conversations);
  } catch (error) {
    console.error('[Messages listConversations]', error);
    res.status(500).json({ error: 'Não foi possível carregar as conversas.' });
  }
}

async function createConversation(req, res) {
  const { name, type = 'direct', memberIds = [] } = req.body;
  if (!Array.isArray(memberIds) || memberIds.length > 100) {
    return res.status(400).json({ error: 'Lista de participantes inválida.' });
  }
  const uniqueMembers = [...new Set([req.userId, ...memberIds.map(Number)])];
  if (!['direct', 'group', 'announcement'].includes(type)) {
    return res.status(400).json({ error: 'Tipo de conversa inválido.' });
  }
  if (type === 'direct' && uniqueMembers.length !== 2) {
    return res.status(400).json({ error: 'Uma conversa direta deve ter duas pessoas.' });
  }
  if (type !== 'direct' && !name?.trim()) {
    return res.status(400).json({ error: 'Informe um nome para o grupo.' });
  }
  if (name && name.trim().length > 120) {
    return res.status(400).json({ error: 'O nome da conversa deve ter até 120 caracteres.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const valid = await client.query(
      `SELECT id FROM users WHERE company_id = $1 AND active = true AND id = ANY($2::bigint[])`,
      [req.companyId, uniqueMembers]
    );
    if (valid.rowCount !== uniqueMembers.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Um ou mais participantes não pertencem à empresa.' });
    }

    if (type === 'direct') {
      const existing = await client.query(
        `SELECT c.id
           FROM conversations c
          WHERE c.company_id = $1 AND c.type = 'direct'
            AND (SELECT array_agg(cm.user_id ORDER BY cm.user_id)
                   FROM conversation_members cm
                  WHERE cm.conversation_id = c.id AND cm.company_id = c.company_id)
                = $2::bigint[]
          LIMIT 1`,
        [req.companyId, uniqueMembers.sort((a, b) => a - b)]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return res.status(200).json(existing.rows[0]);
      }
    }

    const created = await client.query(
      `INSERT INTO conversations (company_id, type, name, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.companyId, type, name?.trim().slice(0, 120) || null, req.userId]
    );
    for (const memberId of uniqueMembers) {
      await client.query(
        `INSERT INTO conversation_members (company_id, conversation_id, user_id)
         VALUES ($1, $2, $3)`,
        [req.companyId, created.rows[0].id, memberId]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(created.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Messages createConversation]', error);
    res.status(500).json({ error: 'Não foi possível criar a conversa.' });
  } finally {
    client.release();
  }
}

async function uploadAttachment(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo JPG, PNG ou PDF.' });
  try {
    const objectPath = await uploadPrivate({
      bucket: 'message-attachments', companyId: req.companyId, userId: req.userId, file: req.file,
    });
    if (!objectPath) return res.status(503).json({ error: 'Armazenamento de anexos indisponível.' });
    res.status(201).json({
      path: objectPath,
      name: req.file.originalname,
      mime_type: req.file.mimetype,
      size: req.file.size,
      url: await signedUrl('message-attachments', objectPath),
    });
  } catch (error) {
    console.error('[Messages uploadAttachment]', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível enviar o anexo.' });
  }
}

async function deleteAttachment(req, res) {
  const { path } = req.body;
  if (!path?.startsWith(`${req.companyId}/${req.userId}/`)) {
    return res.status(400).json({ error: 'Anexo inválido.' });
  }
  try {
    // Só deixa apagar um anexo que ainda não foi usado -- uma vez que a
    // mensagem foi enviada, o anexo já apareceu pra todo mundo na
    // conversa; apagar o arquivo nesse ponto deixaria um link quebrado
    // pra eles, sem nenhum aviso.
    const used = await db.query(
      `SELECT 1 FROM messages
        WHERE company_id = $1 AND deleted_at IS NULL AND attachments @> $2::jsonb LIMIT 1`,
      [req.companyId, JSON.stringify([{ path }])]
    );
    if (used.rows.length) {
      return res.status(409).json({ error: 'Este anexo já foi enviado numa mensagem e não pode mais ser removido.' });
    }
    await removePrivate('message-attachments', path);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível remover o anexo.' });
  }
}

async function getMessages(req, res) {
  const conversationId = parsePositiveId(req.params.id);
  if (!conversationId) return res.status(400).json({ error: 'Conversa inválida.' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  try {
    const conversation = await assertMember(req.companyId, req.userId, conversationId);
    if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada.' });
    const result = await db.query(
      `SELECT m.id, m.body, m.message_type, m.attachments, m.created_at,
              u.id AS sender_id, u.name AS sender_name, u.photo_url AS sender_photo,
              COUNT(mr.user_id)::int AS read_count
         FROM messages m
         JOIN users u ON u.id = m.sender_id AND u.company_id = m.company_id
         LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.company_id = m.company_id
        WHERE m.company_id = $1 AND m.conversation_id = $2 AND m.deleted_at IS NULL
        GROUP BY m.id, u.id
        ORDER BY m.created_at DESC LIMIT $3`,
      [req.companyId, conversationId, limit]
    );
    const messages = await Promise.all(result.rows.reverse().map(async message => ({
      ...message,
      sender_photo: await signedUrl('avatars', message.sender_photo),
      attachments: await Promise.all((message.attachments || []).map(async attachment => ({
        ...attachment,
        url: await signedUrl('message-attachments', attachment.path),
      }))),
    })));
    res.json({ conversation, messages });
  } catch (error) {
    console.error('[Messages getMessages]', error);
    res.status(500).json({ error: 'Não foi possível carregar as mensagens.' });
  }
}

async function sendMessage(req, res) {
  const { body, messageType = 'text', attachments = [], clientMessageId = null } = req.body;
  const attachmentList = Array.isArray(attachments) ? attachments : [];
  if (typeof body === 'string' && body.length > 10000) {
    return res.status(400).json({ error: 'A mensagem deve ter até 10.000 caracteres.' });
  }
  if (attachmentList.length > 10) {
    return res.status(400).json({ error: 'Envie no máximo 10 anexos por mensagem.' });
  }
  if (!body?.trim() && !attachmentList.length) {
    return res.status(400).json({ error: 'A mensagem não pode estar vazia.' });
  }
  if (!['text', 'file', 'system'].includes(messageType)) {
    return res.status(400).json({ error: 'Tipo de mensagem inválido.' });
  }
  if (clientMessageId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(clientMessageId))) {
    return res.status(400).json({ error: 'Identificador de mensagem inválido.' });
  }
  const safeAttachments = attachmentList.filter(attachment =>
    attachment?.path?.startsWith(`${req.companyId}/${req.userId}/`) &&
    ['image/jpeg', 'image/png', 'application/pdf'].includes(attachment.mime_type) &&
    Number(attachment.size) > 0 && Number(attachment.size) <= 5 * 1024 * 1024
  ).map(attachment => ({
    path: attachment.path,
    name: String(attachment.name || 'Arquivo').slice(0, 180),
    mime_type: String(attachment.mime_type || ''),
    size: Number(attachment.size) || 0,
  }));
  if (!body?.trim() && !safeAttachments.length) {
    return res.status(400).json({ error: 'O anexo enviado é inválido.' });
  }
  const trimmedBody = body?.trim() || '';
  try {
    // Uma única ida ao banco no caminho feliz: checa membership, insere a
    // mensagem com idempotência e marca como lida pelo remetente, tudo numa
    // query só via CTEs.
    const result = await db.query(
      `WITH member AS (
         SELECT 1 FROM conversations c
           JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.company_id = c.company_id
          WHERE c.id = $2::bigint AND c.company_id = $1::bigint AND cm.user_id = $3::bigint
       ),
       inserted AS (
         INSERT INTO messages (company_id, conversation_id, sender_id, body, message_type, attachments, client_message_id)
         SELECT $1::bigint, $2::bigint, $3::bigint, $4::text, $5::varchar, $6::jsonb, $7::uuid
         WHERE EXISTS (SELECT 1 FROM member)
         ON CONFLICT (company_id, conversation_id, sender_id, client_message_id) DO NOTHING
         RETURNING *
       ),
       read_marked AS (
         INSERT INTO message_reads (company_id, message_id, user_id)
         SELECT company_id, id, $3::bigint FROM inserted
         ON CONFLICT DO NOTHING
       )
       SELECT * FROM inserted`,
      [req.companyId, req.params.id, req.userId, trimmedBody, messageType, JSON.stringify(safeAttachments), clientMessageId || null]
    );

    let message = result.rows[0];
    if (!message) {
      // Caminho raro: ou o usuário não é membro, ou o cliente repetiu o
      // mesmo idempotency key. Uma segunda ida resolve os dois casos.
      const conversation = await assertMember(req.companyId, req.userId, req.params.id);
      if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada.' });
      if (!clientMessageId) return res.status(500).json({ error: 'Não foi possível confirmar a mensagem.' });
      const existing = await db.query(
        `SELECT * FROM messages WHERE company_id=$1 AND conversation_id=$2
          AND sender_id=$3 AND client_message_id=$4::uuid LIMIT 1`,
        [req.companyId, req.params.id, req.userId, clientMessageId]
      );
      message = existing.rows[0];
    }
    res.status(201).json(message);
  } catch (error) {
    console.error('[Messages sendMessage]', error);
    res.status(500).json({ error: 'Não foi possível enviar a mensagem.' });
  }
}

async function markRead(req, res) {
  const conversationId = parsePositiveId(req.params.id);
  if (!conversationId) return res.status(400).json({ error: 'Conversa inválida.' });
  try {
    const conversation = await assertMember(req.companyId, req.userId, conversationId);
    if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada.' });
    await db.query(
      `INSERT INTO message_reads (company_id, message_id, user_id)
       SELECT m.company_id, m.id, $3
         FROM messages m
        WHERE m.company_id = $1 AND m.conversation_id = $2 AND m.deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [req.companyId, conversationId, req.userId]
    );
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível atualizar a leitura.' });
  }
}

module.exports = { listConversations, createConversation, uploadAttachment, deleteAttachment, getMessages, sendMessage, markRead };
