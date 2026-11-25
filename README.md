# Radar · Plataforma de vagas

Radar é um espaço pessoal para organizar uma busca de emprego. O projeto começa com perfil, vagas e candidaturas vazios.

- Cadastre vagas pelo link original e busque por cargo, empresa e palavra-chave.
- Compare as competências do perfil com os requisitos informados para cada vaga.
- Organize candidaturas em quatro etapas, com anotações e movimentação pelo quadro.
- Revise o conteúdo do currículo e exporte um PDF com texto selecionável.
- Ative a busca na Gupy com os filtros de cargo, cidade, modalidade, senioridade e aderência.

A busca automática consulta o [MCP oficial da Gupy para candidatos](https://candidatos.gupy.io/ia-para-pessoas-candidatas) e mostra o link da publicação original. Para começar, adicione cargos em Meus alertas, ative a busca e salve as preferências. Também é possível consultar na hora pelo botão **Buscar na Gupy agora**. O Radar envia os termos de cargo e os filtros de cidade e modalidade à fonte. A comparação com as competências acontece no servidor do Radar. Vagas de outras fontes podem ser adicionadas pelo link.

No ambiente hospedado, a tarefa vinculada ao Site pode acionar `POST /api/discovery/scheduled` usando a conexão privada do Sites. A busca guarda os resultados por conta, evita alertas repetidos e preserva a última consulta concluída se a Gupy estiver indisponível.

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
