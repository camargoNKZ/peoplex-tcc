module.exports = feature => (req, res, next) => {
  if (req.features && req.features[feature] === false)
    return res.status(403).json({ error: 'Você não tem acesso a esta funcionalidade.', feature });
  next();
};
