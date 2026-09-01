# TASKS SEVEN

Gestor de tarefas em kanban, com rotinas que se renovam sozinhas, painel de desempenho e acompanhamento de saúde de clientes.

**Aplicação:** https://contatonetoferreira10-blip.github.io/tasksmanagerseven/

Sem build, sem dependências, sem servidor: é HTML, CSS e JavaScript puro. Abre no navegador e funciona.

---

## Os três tipos de tarefa

O eixo do app não é "quando", é **recorrência**:

| Tipo | Ao concluir | Na virada do dia |
|---|---|---|
| **Única** | fica na coluna Concluído | sai do quadro e vai pro Histórico |
| **Diária** | fica na coluna Concluído | volta pra coluna de origem, desmarcada |
| **Semanal** | fica na coluna Concluído | descansa fora do quadro e volta na segunda |

Rotinas acumulam **sequência**, que zera quando um ciclo passa sem conclusão. A transição é reavaliada ao abrir o app, ao voltar pra aba e a cada minuto — funciona mesmo deixando a página aberta a noite toda.

## Clientes

Cada tarefa pode ser vinculada a um cliente, e basta digitar um nome novo no campo para criá-lo. Os clientes têm um kanban próprio com cinco status de saúde de conta: **Geral, Cliente feliz, Cliente neutro, Cliente crítico e Churn**. O card do cliente mostra quantas tarefas estão abertas e quantas foram entregues nos últimos 30 dias.

## Desempenho

Todas as métricas vêm de um registro append-only de eventos — o estado do quadro não serve para isso, porque ele não sabe o que aconteceu ontem.

- entregues, média por dia, aderência das rotinas e ciclo médio (criação → entrega)
- entregas por dia, por cliente e por tag
- saldo do período: criadas contra entregues
- rotinas ordenadas da pior para a melhor aderência
- tarefas paradas há mais de 5 dias e entregas que furaram prazo

A aderência de rotina diária conta **só dias úteis por padrão**, com alternância no painel — senão fim de semana vira falsa falha.

O painel mede **vazão**, não impacto: uma semana de 30 entregas pequenas aparece maior que uma de 3 decisivas.

## Atalhos

| Tecla | Ação |
|---|---|
| `N` | nova tarefa (ou novo cliente, na aba Clientes) |
| `C` | alterna entre Tarefas e Clientes |
| `D` | painel de desempenho |
| `H` | histórico e rotinas em descanso |
| `/` | busca |
| `Esc` | fecha o que estiver aberto |

## Onde ficam os dados

**No seu navegador, e só nele.** Não existe servidor, conta ou sincronização: tudo mora no `localStorage`, sob o endereço em que você abre o app.

Duas consequências práticas:

- Abrir por um endereço diferente (o arquivo local e o site publicado, por exemplo) significa **quadros diferentes**. Para mudar de um para o outro, use ⋮ → *Exportar backup* e depois ⋮ → *Importar backup*.
- Limpar os dados do site no navegador apaga o quadro. Exporte um backup de vez em quando.

Nada de cliente, tarefa ou métrica é versionado neste repositório — o `.gitignore` bloqueia os backups exportados, e a carteira inicial de clientes é propositalmente vazia no código.

## Estrutura

```
index.html        markup e modais
css/styles.css    tema (tokens --violet-* no :root)
js/store.js       persistência e migrações  ← fronteira para um backend futuro
js/clients.js     clientes e o kanban de status
js/stats.js       cálculo e desenho do painel de desempenho
js/app.js         quadro de tarefas, virada de ciclo e interface
```

Toda leitura e escrita passa por `store.js`. Quando existir um backend, basta trocar o corpo de `load`/`save` por chamadas HTTP — o resto do app não muda.

## Rodando localmente

Abra o `index.html` no navegador. Só isso.

Se preferir servir por HTTP:

```bash
npx serve .
```
