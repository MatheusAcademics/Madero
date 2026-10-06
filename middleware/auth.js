//verificação de usuário logado
const verificaUsuario = (req, res, next) => {
    if (req.session && req.session.user) {
        next(); // usuário autenticado, prossegue para a próxima função
    } else {
        const mensagem = encodeURIComponent ('Você precisa estar logado para acessar esta página.');
        res.redirect(`/usuarios/login?mensagem=${mensagem}`); // redireciona para a página de login
    }
};

module.exports = verificaUsuario;