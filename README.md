# Radar · Plataforma de vagas

Radar é um espaço pessoal para organizar uma busca de emprego. O projeto começa com perfil, vagas e candidaturas vazios.

- Cadastre vagas pelo link original e busque por cargo, empresa e palavra-chave.
- Compare as competências do perfil com os requisitos informados para cada vaga.
- Organize candidaturas em quatro etapas, com anotações e movimentação pelo quadro.
- Revise o conteúdo do currículo e exporte um PDF com texto selecionável.
- Configure alertas dentro do Radar com os filtros de cargo, modalidade, senioridade e aderência.

Gupy, LinkedIn e outras fontes podem ser registradas por link. O cadastro usa as informações preenchidas no formulário. Os alertas são calculados sobre as vagas cadastradas.

## Executar localmente

Requer Node.js 22.13 ou superior.

~~~sh
npm start
~~~

Acesse http://127.0.0.1:4173. O servidor local escuta somente nesse endereço e guarda os dados em SQLite no diretório ignorado `.radar-local/`.

## Código e hospedagem

- `web/` contém as telas, a lógica do navegador e os arquivos visuais.
- `server/worker.js` contém a API do espaço pessoal e serve os arquivos do site.
- `drizzle/` contém a migração do banco.
- `npm run build` gera o Worker de produção em `dist/server/index.js`.

Na hospedagem, o Worker usa o banco D1 no binding `DB`. A plataforma de hospedagem protege o acesso com login do ChatGPT e fornece ao Worker o identificador da pessoa autenticada. O banco mantém perfis, vagas e candidaturas separados por conta. A migração deve ser aplicada antes de iniciar o Worker.

O visual segue as sete telas do Radar no Figma, com tipografia Inter e a identidade em verde escuro.
