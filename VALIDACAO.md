# Validação — Vortex em segundo plano

Data: 16/10/2026. Edição azul. Pacote: 1.3.1. Chrome: 1.0.8. Extensão do Vortex: 1.1.1.

Esta edição altera a apresentação visual e a documentação em uma cópia separada. A pasta de uso atual, a extensão instalada no Vortex e o ZIP anterior foram preservados; seus arquivos foram conferidos por SHA-256.

## Verificações desta versão

**17 testes de lógica aprovados**, cobrindo identificação de jogo/mod/arquivo, autenticação local, pausa, confirmação do Vortex, troca de solicitações, rejeição de links antigos, preservação de abas comuns, busca do botão em Shadow DOM e captura dos links gerados pela página.

Um teste adicional carregou a extensão real desta edição em Chromium, com perfil isolado e páginas e fila simuladas. Processou dois mods diferentes em sequência, entregou os links na ordem, fechou as duas abas gerenciadas, preservou uma aba comum e não solicitou abertura em primeiro plano. Nenhum erro foi observado. A logo carregou corretamente e não houve transbordamento horizontal no painel de 380 pixels.

A imagem `previa-painel.png` foi obtida desse teste simulado. Não representa downloads reais realizados pelo teste.

## Confirmações em uso real

O usuário confirmou que o botão **Slow download** foi acionado e que o download começou. Após a correção da troca de solicitações, confirmou também que a automação passou a funcionar corretamente na coleção real.

Essas confirmações se referem ao fluxo de cliques preservado nesta versão. O teste integrado da versão atual usa respostas simuladas e não constitui uma nova execução contra a Nexus Mods.

## Escopo

O pacote contém apenas a automação de cliques. Não inclui laboratório de velocidade, resolução de links por sessão exportada, leitura de cookies, chave de API, proxy de transferência, bibliotecas Python ou arquivos temporários de mods.

A versão distribuída é preparada sem segredos locais. O instalador configura a comunicação entre as duas extensões na primeira execução.

A integração foi desenvolvida para o Vortex 2.8.2. Atualizações do aplicativo ou do site podem exigir ajustes. Login, CAPTCHA e instaladores interativos continuam exigindo intervenção do usuário.

O instalador, preservado sem alterações em relação ao pacote anterior, foi testado no Windows PowerShell 5.1 em uma pasta isolada, simulando a primeira instalação. Gerou uma chave independente e configurou as duas extensões com a mesma identificação e chave. O ZIP desta edição também foi preparado com a chave em branco.
