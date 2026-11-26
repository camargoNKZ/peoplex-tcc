const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const uploadRoot = process.env.VERCEL
  ? path.join('/tmp', 'peoplex-uploads')
  : path.resolve(__dirname, '../../public/uploads');
const uploadDirs = {
  foto: path.join(uploadRoot, 'fotos'),
  documento: path.join(uploadRoot, 'documentos'),
};

// /tmp é gravável nas funções da Vercel; arquivos permanentes irão para o Supabase Storage.
Object.values(uploadDirs).forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const diskStorage = multer.diskStorage({
  destination(req, file, cb) {
    const pasta = file.fieldname === 'foto' ? uploadDirs.foto : uploadDirs.documento;
    cb(null, pasta);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.userId}_${Date.now()}${ext}`);
  },
});

const storage = process.env.SUPABASE_URL ? multer.memoryStorage() : diskStorage;

function fileFilter(req, file, cb) {
  const allowed = /jpeg|jpg|png|pdf/;
  const ext  = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true);
  else cb(new Error('Apenas arquivos JPG, PNG e PDF são permitidos.'));
}

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});
