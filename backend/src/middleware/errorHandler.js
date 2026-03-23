const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with this data already exists.', field: err.meta?.target });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error.',
  });
};

module.exports = { errorHandler };
