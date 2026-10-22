// Entry point: pull the saved database down (if configured) before anything opens it.
const persist = require('./persist');

persist
  .restore()
  .catch((e) => {
    // Refuse to start on an empty database: the first backup would overwrite the real data.
    console.error('Kalıcı veritabanına bağlanılamadı:', e.message);
    process.exit(1);
  })
  .then(() => {
    require('./index');
    persist.startBackups(require('./db'));
  });
