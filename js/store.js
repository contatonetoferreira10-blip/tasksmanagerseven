/* ============================================================
   TASKS SEVEN — camada de dados
   Toda leitura/escrita passa por aqui. Quando o backend existir,
   basta trocar o corpo dos métodos por chamadas HTTP (a UI não muda).
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'fluxo.board.v1';        // não renomear: é onde o quadro do usuário vive
  var ARCHIVE_CAP = 500;
  var LOG_CAP = 6000;

  function uid() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function isoOf(ms) {
    var d = new Date(ms);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function seed() {
    var todo = uid(), doing = uid(), done = uid();
    var now = Date.now();
    return {
      version: 4,
      lastRollover: null,
      clients: [],
      columns: [
        { id: todo,  title: 'A fazer',   accent: '#a78bfa', done: false },
        { id: doing, title: 'Em curso',  accent: '#8b5cf6', done: false },
        { id: done,  title: 'Concluído', accent: '#4ade80', done: true  }
      ],
      tasks: [
        {
          id: uid(), columnId: todo, title: 'Checar as contas do dia',
          notes: 'Rotina diária: some ao concluir e volta amanhã de manhã.',
          kind: 'diaria', priority: 'media', tags: ['rotina'], due: null,
          done: false, doneAt: null, lastDone: null, streak: 0, sleeping: false,
          prevColumn: null, createdAt: now
        },
        {
          id: uid(), columnId: todo, title: 'Fechar relatório da semana',
          notes: 'Rotina semanal: ao concluir, só reaparece na segunda.',
          kind: 'semanal', priority: 'alta', tags: ['relatório'], due: null,
          done: false, doneAt: null, lastDone: null, streak: 0, sleeping: false,
          prevColumn: null, createdAt: now
        },
        {
          id: uid(), columnId: doing, title: 'Tarefa única de exemplo',
          notes: 'Ao concluir, fica visível hoje e some do quadro na virada do dia (vai pro Histórico).',
          kind: 'unica', priority: 'media', tags: [], due: null,
          done: false, doneAt: null, lastDone: null, streak: 0, sleeping: false,
          prevColumn: null, createdAt: now
        }
      ],
      archive: [],
      log: []
    };
  }

  var KINDS = ['unica', 'diaria', 'semanal'];

  /* Carteira inicial opcional. Fica vazia no repositório de propósito:
     nome de cliente é dado de negócio e não deve viver no código-fonte.
     Para carregar a sua, use ⋮ → Importar backup, ou preencha aqui numa
     cópia local (o .gitignore já protege arquivos *.local.js). */
  var CLIENTES_INICIAIS = [];

  function seedClientes(data) {
    if (data.clientsSeeded) return;
    CLIENTES_INICIAIS.forEach(function (nome) {
      var existe = false;
      data.clients.forEach(function (c) {
        if (c.name.trim().toLowerCase() === nome.toLowerCase()) existe = true;
      });
      if (!existe) {
        data.clients.push({
          id: uid(), name: nome, status: 'geral', notes: '', createdAt: Date.now()
        });
      }
    });
    data.clientsSeeded = true;
  }

  /* Semeia o registro de eventos a partir do que já existe no quadro.
     Só roda uma vez, na migração para a v3. É um retrato parcial —
     dias pulados no passado não deixaram rastro e não dá pra inventar. */
  function backfillLog(data) {
    var log = [];
    data.tasks.forEach(function (t) {
      if (t.createdAt) {
        log.push({ d: isoOf(t.createdAt), t: t.createdAt, e: 'created', id: t.id,
                   title: t.title, kind: t.kind, pri: t.priority, tags: t.tags, seed: 1 });
      }
      if (t.lastDone) {
        log.push({ d: t.lastDone, t: new Date(t.lastDone + 'T12:00:00').getTime(), e: 'done', id: t.id,
                   title: t.title, kind: t.kind, pri: t.priority, tags: t.tags,
                   cd: t.createdAt ? isoOf(t.createdAt) : null, due: t.due || null, seed: 1 });
      }
    });
    (data.archive || []).forEach(function (a) {
      log.push({ d: a.doneAt, t: new Date(a.doneAt + 'T12:00:00').getTime(), e: 'done', id: a.id,
                 title: a.title, kind: a.kind, pri: a.priority, tags: a.tags,
                 cd: null, due: null, seed: 1 });
    });
    log.sort(function (a, b) { return a.t - b.t; });
    return log;
  }

  function normalize(data) {
    if (!data || !Array.isArray(data.columns) || !Array.isArray(data.tasks)) return seed();

    if (!Array.isArray(data.archive)) data.archive = [];
    if (!Array.isArray(data.clients)) data.clients = [];   // v3 -> v4

    var STATUS_OK = ['geral', 'feliz', 'neutro', 'critico', 'churn'];
    data.clients.forEach(function (c) {
      if (STATUS_OK.indexOf(c.status) < 0) c.status = 'geral';
      c.name = String(c.name || 'Sem nome').slice(0, 40);
      c.notes = c.notes || '';
      if (!c.createdAt) c.createdAt = Date.now();
    });
    seedClientes(data);
    if (!('lastRollover' in data)) data.lastRollover = null;

    data.tasks.forEach(function (t) {
      // migração v1 -> v2: "scope" (horizonte) virou "kind" (recorrência)
      if (!t.kind) t.kind = t.scope === 'dia' ? 'diaria' : (t.scope === 'semana' ? 'semanal' : 'unica');
      delete t.scope;

      if (KINDS.indexOf(t.kind) < 0) t.kind = 'unica';
      if (['baixa', 'media', 'alta'].indexOf(t.priority) < 0) t.priority = 'media';
      t.tags = Array.isArray(t.tags) ? t.tags : [];
      t.done = !!t.done;
      t.sleeping = !!t.sleeping;
      t.streak = t.streak || 0;
      t.doneAt = t.doneAt || null;
      t.lastDone = t.lastDone || null;
      t.prevColumn = t.prevColumn || null;
      t.client = t.client || null;
      if (!t.createdAt) t.createdAt = Date.now();
    });

    // descarta tarefas órfãs (coluna apagada fora do app)
    var ids = data.columns.map(function (c) { return c.id; });
    data.tasks = data.tasks.filter(function (t) { return ids.indexOf(t.columnId) >= 0; });

    // migração v2 -> v3: registro de eventos para a análise de desempenho
    if (!Array.isArray(data.log)) data.log = backfillLog(data);

    if (data.archive.length > ARCHIVE_CAP) data.archive.length = ARCHIVE_CAP;
    if (data.log.length > LOG_CAP) data.log = data.log.slice(-LOG_CAP);
    // cliente apagado fora do app: solta a referência em vez de quebrar o card
    var cids = data.clients.map(function (c) { return c.id; });
    data.tasks.forEach(function (t) { if (t.client && cids.indexOf(t.client) < 0) t.client = null; });

    data.version = 4;
    return data;
  }

  var Store = {
    uid: uid,
    isoOf: isoOf,
    ARCHIVE_CAP: ARCHIVE_CAP,
    LOG_CAP: LOG_CAP,

    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        return normalize(raw ? JSON.parse(raw) : seed());
      } catch (e) {
        console.warn('[tasks-seven] falha ao ler storage, começando do zero', e);
        return seed();
      }
    },

    save: function (data) {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        console.error('[tasks-seven] falha ao salvar', e);
        return false;
      }
    },

    reset: function () {
      localStorage.removeItem(KEY);
      return normalize(seed());
    },

    export: function (data) {
      return JSON.stringify(data, null, 2);
    },

    import: function (json) {
      return normalize(JSON.parse(json));
    }
  };

  global.Store = Store;
})(window);
