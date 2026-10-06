const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('cardapio', { mainClass: 'main-cardapio' }); // renderiza views/cardapio.ejs
});

module.exports = router;
