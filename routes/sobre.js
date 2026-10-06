const express = require('express');
const router = express.Router();

// Rota para a página "Sobre Nós"
router.get('/', (req, res) => {
  res.render('sobre', { mainClass: 'main-sobre' });
});

module.exports = router;
