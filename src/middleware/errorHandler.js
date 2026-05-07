const config = require('../config');

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = config.env === 'production' && status >= 500
    ? 'Something went wrong. Please try again.'
    : err.message;

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}: ${err.message}`);
  if (err.stack && config.env !== 'production') console.error(err.stack);

  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/orders/export')) {
    return res.status(status).json({ error: message });
  }

  res.status(status).send(`<h1>${status} Error</h1><p>${message}</p><a href="/">← Home</a>`);
}

module.exports = { errorHandler };
