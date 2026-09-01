/* ============================================================
   TASKS SEVEN — interface do quadro

   Modelo de tarefa
   ----------------
   kind = 'unica'   -> feita uma vez. Fica visível na coluna Concluído
                       pelo resto do dia e some do quadro na virada
                       (vai pro Histórico).
   kind = 'diaria'  -> rotina. Ao concluir vai pra Concluído; na virada
                       do dia volta pra coluna de origem, desmarcada.
   kind = 'semanal' -> rotina. Ao concluir vai pra Concluído; na virada
                       do dia entra em "descanso" (sai do quadro) e volta
                       sozinha na segunda-feira seguinte.

   Toda essa transição acontece em rollover(), que roda ao abrir o app,
   ao voltar pra aba e a cada minuto — pra funcionar mesmo com o app
   deixado aberto durante a noite.
   ============================================================ */
(function () {
  'use strict';

  var state = Store.load();
  var filters = { q: '', view: 'tudo' };
  var editingId = null;
  var pendingKill = null;
  var ACCENTS = ['#a78bfa', '#8b5cf6', '#c4b5fd', '#e879f9', '#7c3aed', '#4ade80', '#60a5fa'];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var board = $('#board');
  var modal = $('#modal');
  var history = $('#history');
  var stats = $('#stats');
  var clientModal = $('#clientModal');
  var menu = $('#menu');
  var statsDays = 30;
  var view = 'tarefas';        // 'tarefas' | 'clientes'
  var editingClient = null;
  var statsUteis = true;   // diárias: fim de semana não conta como falha

  /* ---------------- datas ---------------- */

  function iso(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function todayISO() { return iso(new Date()); }
  function addDays(isoStr, n) {
    var d = new Date(isoStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return iso(d);
  }
  function weekStart(isoStr) {                    // segunda-feira da semana
    var d = new Date(isoStr + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
  }
  function daysUntil(isoStr) {
    return Math.round((new Date(isoStr + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
  }
  function prettyDate(isoStr) {
    var d = daysUntil(isoStr);
    if (d === 0) return 'hoje';
    if (d === -1) return 'ontem';
    if (d === 1) return 'amanhã';
    var p = isoStr.split('-');
    return p[2] + '/' + p[1];
  }

  /* ---------------- utilitários ---------------- */

  function save() { Store.save(state); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var PRI_COLOR = { baixa: '#6b7280', media: '#8b5cf6', alta: '#e879f9' };
  var PRI_LABEL = { baixa: 'baixa', media: 'média', alta: 'alta' };
  var KIND_LABEL = { unica: 'única', diaria: 'diária', semanal: 'semanal' };
  var KIND_HINT = {
    unica: 'Feita uma vez. Fica no Concluído até virar o dia e depois vai pro Histórico.',
    diaria: 'Rotina: ao concluir sai do caminho e volta amanhã, desmarcada.',
    semanal: 'Rotina: ao concluir descansa o resto da semana e volta na segunda.'
  };
  var REPEAT_ICON = '<svg viewBox="0 0 24 24" class="mini"><path d="M17 2l3 3-3 3"/><path d="M4 12V9a4 4 0 014-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 12v3a4 4 0 01-4 4H4"/></svg>';

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* Registro append-only: é a única fonte da análise de desempenho.
     O estado do quadro diz como as coisas estão; só o log diz como foram. */
  function logEvent(type, t, extra) {
    if (!state.log) state.log = [];
    var ev = {
      d: todayISO(), t: Date.now(), e: type, id: t.id, title: t.title,
      kind: t.kind, pri: t.priority, tags: (t.tags || []).slice(),
      cliId: t.client || null, cli: clientName(t.client)
    };
    if (extra) Object.keys(extra).forEach(function (k) { ev[k] = extra[k]; });
    state.log.push(ev);
    if (state.log.length > Store.LOG_CAP) state.log = state.log.slice(-Store.LOG_CAP);
  }

  function clientName(id) {
    var c = Clients.byId(state, id);
    return c ? c.name : null;
  }

  function colById(id) {
    return state.columns.filter(function (c) { return c.id === id; })[0];
  }
  function doneColumn() {
    return state.columns.filter(function (c) { return c.done; })[0];
  }
  function taskById(id) {
    return state.tasks.filter(function (t) { return t.id === id; })[0];
  }
  function onBoard() {
    return state.tasks.filter(function (t) { return !t.sleeping; });
  }

  function streakLabel(t) {
    if (!t.streak || t.streak < 2) return null;
    return t.streak + (t.kind === 'diaria' ? ' dias' : ' semanas');
  }

  /* ---------------- virada de ciclo ---------------- */

  function revive(t) {
    t.done = false;
    t.sleeping = false;
    t.doneAt = null;
    var back = t.prevColumn && colById(t.prevColumn) ? t.prevColumn : state.columns[0].id;
    t.columnId = back;
    t.prevColumn = null;
  }

  function archive(t) {
    state.archive.unshift({
      id: t.id, title: t.title, notes: t.notes || '', tags: t.tags || [],
      kind: t.kind, priority: t.priority, doneAt: t.doneAt || todayISO()
    });
    if (state.archive.length > Store.ARCHIVE_CAP) state.archive.length = Store.ARCHIVE_CAP;
    logEvent('archived', t);
    state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; });
  }

  function rollover() {
    var today = todayISO();
    if (state.lastRollover === today) return false;

    var moved = { arquivadas: 0, renovadas: 0, descansando: 0 };

    state.tasks.slice().forEach(function (t) {
      if (t.done && t.doneAt && t.doneAt < today) {
        if (t.kind === 'unica') { archive(t); moved.arquivadas++; return; }
        if (t.kind === 'diaria') { revive(t); moved.renovadas++; return; }
        // semanal: descansa até a próxima segunda
        if (weekStart(t.doneAt) === weekStart(today)) { t.sleeping = true; moved.descansando++; }
        else { revive(t); moved.renovadas++; }
        return;
      }
      if (t.sleeping && t.doneAt && weekStart(t.doneAt) !== weekStart(today)) {
        revive(t); moved.renovadas++;
        return;
      }
      // sequência quebrada: não fez no ciclo anterior
      if (!t.done && t.streak) {
        if (t.kind === 'diaria' && t.lastDone !== today && t.lastDone !== addDays(today, -1)) t.streak = 0;
        if (t.kind === 'semanal' && t.lastDone &&
            weekStart(t.lastDone) !== weekStart(today) &&
            weekStart(t.lastDone) !== addDays(weekStart(today), -7)) t.streak = 0;
      }
    });

    var first = state.lastRollover === null;
    state.lastRollover = today;
    save();

    if (!first && (moved.arquivadas || moved.renovadas || moved.descansando)) {
      var partes = [];
      if (moved.renovadas) partes.push(moved.renovadas + ' rotina(s) renovada(s)');
      if (moved.arquivadas) partes.push(moved.arquivadas + ' arquivada(s)');
      if (moved.descansando) partes.push(moved.descansando + ' em descanso');
      toast('Novo ciclo: ' + partes.join(', ') + '.');
    }
    return true;
  }

  /* ---------------- filtros ---------------- */

  function isLate(t) {
    return !!(t.due && !t.done && daysUntil(t.due) < 0);
  }

  function matches(t) {
    var v = filters.view;
    if (v === 'rotinas' && t.kind === 'unica') return false;
    if (v === 'atrasadas' && !isLate(t)) return false;
    if (v === 'hoje') {
      var relevante = t.kind === 'diaria' ||
                      (t.doneAt === todayISO()) ||
                      (t.due && daysUntil(t.due) <= 0);
      if (!relevante) return false;
    }
    if (!filters.q) return true;
    var hay = (t.title + ' ' + (t.notes || '') + ' ' + t.tags.join(' ') +
               ' ' + (clientName(t.client) || '')).toLowerCase();
    return hay.indexOf(filters.q) >= 0;
  }

  function tasksOf(colId) {
    return onBoard().filter(function (t) { return t.columnId === colId; });
  }

  /* ---------------- render ---------------- */

  function render() {
    syncTopbar();
    if (view === 'clientes') return renderClients();
    board.classList.remove('board-clients');
    board.innerHTML = '';

    state.columns.forEach(function (col) {
      var sec = document.createElement('section');
      sec.className = 'column';
      sec.dataset.col = col.id;
      sec.style.setProperty('--acc', col.accent);

      var list = tasksOf(col.id);
      var visible = list.filter(matches);

      sec.innerHTML =
        '<div class="col-accent"></div>' +
        '<div class="col-head">' +
          '<span class="col-dot"></span>' +
          '<input class="col-title" value="' + esc(col.title) + '" maxlength="28" spellcheck="false">' +
          '<span class="count">' + visible.length + '</span>' +
          '<button class="col-btn add" title="Nova tarefa nesta coluna" aria-label="Nova tarefa">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M5 12h14"/></svg>' +
          '</button>' +
          '<button class="col-btn kill" title="Excluir coluna" aria-label="Excluir coluna">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="col-body" data-col="' + col.id + '"></div>';

      var body = $('.col-body', sec);
      list.forEach(function (t) { body.appendChild(cardEl(t, matches(t))); });

      if (!visible.length) {
        var empty = document.createElement('div');
        empty.className = 'col-empty';
        empty.textContent = list.length ? 'nada aqui com esse filtro' : 'solte uma tarefa aqui';
        body.appendChild(empty);
      }

      wireColumn(sec, col, body);
      board.appendChild(sec);
    });

    var add = document.createElement('button');
    add.className = 'col-new';
    add.innerHTML = '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M5 12h14"/></svg> Nova coluna';
    add.addEventListener('click', addColumn);
    board.appendChild(add);

    updateProgress();
    updateSleepingHint();
  }

  function cardEl(t, visible) {
    var el = document.createElement('article');
    el.className = 'card' + (t.done ? ' is-done' : '');
    el.draggable = true;
    el.dataset.id = t.id;
    el.style.setProperty('--pri', PRI_COLOR[t.priority]);
    if (!visible) el.hidden = true;

    var meta = '';
    if (t.kind !== 'unica') {
      meta += '<span class="badge rec ' + t.kind + '">' + REPEAT_ICON + KIND_LABEL[t.kind] + '</span>';
      var sl = streakLabel(t);
      if (sl) meta += '<span class="badge streak">' + sl + '</span>';
    }
    if (t.priority !== 'media') {
      meta += '<span class="badge" style="color:' + PRI_COLOR[t.priority] + '">' + PRI_LABEL[t.priority] + '</span>';
    }
    if (t.due && t.kind === 'unica') {
      var d = daysUntil(t.due);
      var cls = d < 0 ? 'late' : (d <= 1 ? 'soon' : '');
      var txt = d < 0 ? Math.abs(d) + 'd atrasada' : (d <= 7 ? prettyDate(t.due) : prettyDate(t.due));
      meta += '<span class="badge due ' + cls + '">' + txt + '</span>';
    }
    var cli = Clients.byId(state, t.client);
    if (cli) {
      var st = Clients.status(cli.status);
      meta += '<span class="badge cli st-' + st.id + '" style="--c:' + st.color + '" title="' + esc(st.label) + '">' +
              '<i class="cdot"></i>' + esc(cli.name) + '</span>';
    }
    t.tags.forEach(function (tag) { meta += '<span class="tag">' + esc(tag) + '</span>'; });

    el.innerHTML =
      '<div class="card-top">' +
        '<button class="tick' + (t.done ? ' on' : '') + '" aria-label="Concluir">' +
          '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>' +
        '</button>' +
        '<h3 class="card-title">' + esc(t.title) + '</h3>' +
      '</div>' +
      (t.notes ? '<p class="card-notes">' + esc(t.notes) + '</p>' : '') +
      (meta ? '<div class="card-meta">' + meta + '</div>' : '') +
      '<div class="card-move">' +
        '<button data-dir="-1" aria-label="Mover para a esquerda"><svg viewBox="0 0 24 24" class="ico"><path d="M15 6l-6 6 6 6"/></svg></button>' +
        '<button data-dir="1" aria-label="Mover para a direita"><svg viewBox="0 0 24 24" class="ico"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '</div>';

    $('.tick', el).addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDone(t.id);
    });

    $$('.card-move button', el).forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        shift(t.id, parseInt(b.dataset.dir, 10));
      });
    });

    el.addEventListener('click', function () { openModal(t.id); });
    el.addEventListener('dragstart', function (e) {
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', t.id); } catch (err) { /* noop */ }
    });
    el.addEventListener('dragend', function () {
      el.classList.remove('dragging');
      $$('.column').forEach(function (c) { c.classList.remove('drop-target'); });
      persistFromDOM();
    });

    return el;
  }

  function renderClients() {
    Clients.render(board, state, {
      contagem: function (id) {
        var desde = addDays(todayISO(), -29);
        return {
          abertas: state.tasks.filter(function (t) {
            return t.client === id && !t.done && !t.sleeping;
          }).length,
          entregues: (state.log || []).filter(function (e) {
            return e.e === 'done' && e.cliId === id && e.d >= desde;
          }).length
        };
      },
      novo: function (st) { openClient(null, st); },
      abrir: function (id) { openClient(id); },
      persistir: function () {
        var ordenados = [];
        $$('.col-body[data-status]').forEach(function (body) {
          $$('.ccard', body).forEach(function (el) {
            var c = Clients.byId(state, el.dataset.id);
            if (!c) return;
            c.status = body.dataset.status;
            ordenados.push(c);
          });
        });
        if (ordenados.length === state.clients.length) state.clients = ordenados;
        save(); render();
      }
    });
  }

  function syncTopbar() {
    var clientes = view === 'clientes';
    $('.scope-filter').hidden = clientes;
    $('.progress').hidden = clientes;
    $('#search').placeholder = clientes ? 'a busca vale para as tarefas  ( / )' : 'Buscar tarefa, tag, cliente…  ( / )';
    $('#search').parentNode.hidden = clientes;
    $('#btnNewLabel').textContent = clientes ? 'Novo cliente' : 'Nova tarefa';
    $$('[data-view-main]').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.viewMain === view);
    });
  }

  function setView(v) {
    view = v;
    render();
  }

  /* ---------------- modal de cliente ---------------- */

  function openClient(id, statusPreset) {
    editingClient = id || null;
    var c = id ? Clients.byId(state, id) : null;

    $('#cliTitle').textContent = c ? 'Cliente' : 'Novo cliente';
    $('#btnDeleteCli').hidden = !c;
    $('#btnDeleteCli').dataset.armed = '';
    $('#btnDeleteCli').textContent = 'Excluir';

    $('#cStatus').innerHTML = Clients.STATUS.map(function (s) {
      return '<option value="' + s.id + '">' + s.label + '</option>';
    }).join('');

    $('#cName').value = c ? c.name : '';
    $('#cNotes').value = c ? c.notes : '';
    $('#cStatus').value = c ? (c.status || 'geral') : (statusPreset || 'geral');

    var n = c ? state.tasks.filter(function (t) { return t.client === c.id; }).length : 0;
    $('#cliTasks').textContent = c
      ? (n ? n + ' tarefa(s) no quadro vinculada(s) a este cliente.' : 'Nenhuma tarefa vinculada ainda.')
      : 'Você também pode criar clientes só digitando o nome no campo Cliente de uma tarefa.';

    clientModal.hidden = false;
    setTimeout(function () { $('#cName').focus(); }, 30);
  }

  function closeClient() { clientModal.hidden = true; editingClient = null; }

  function submitClient(e) {
    e.preventDefault();
    var nome = $('#cName').value.trim();
    if (!nome) return;

    var repetido = Clients.byName(state, nome);
    if (repetido && repetido.id !== editingClient) {
      return toast('Já existe um cliente chamado “' + repetido.name + '”.');
    }

    if (editingClient) {
      var c = Clients.byId(state, editingClient);
      c.name = nome; c.notes = $('#cNotes').value.trim(); c.status = $('#cStatus').value;
    } else {
      state.clients.push({
        id: Store.uid(), name: nome, status: $('#cStatus').value,
        notes: $('#cNotes').value.trim(), createdAt: Date.now()
      });
    }
    save(); closeClient(); render();
  }

  $('#clientForm').addEventListener('submit', submitClient);
  $('#btnCloseCli').addEventListener('click', closeClient);
  $('#btnCancelCli').addEventListener('click', closeClient);
  clientModal.addEventListener('click', function (e) { if (e.target === clientModal) closeClient(); });

  $('#btnDeleteCli').addEventListener('click', function () {
    var btn = $('#btnDeleteCli');
    var n = state.tasks.filter(function (t) { return t.client === editingClient; }).length;
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = n ? 'Confirmar (' + n + ' tarefa(s) ficam sem cliente)' : 'Confirmar exclusão';
      return;
    }
    state.tasks.forEach(function (t) { if (t.client === editingClient) t.client = null; });
    state.clients = state.clients.filter(function (c) { return c.id !== editingClient; });
    save(); closeClient(); render();
  });

  $$('[data-view-main]').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.viewMain); });
  });

  function updateProgress() {
    var vis = onBoard().filter(matches);
    var done = vis.filter(function (t) { return t.done; }).length;
    var pct = vis.length ? done / vis.length : 0;
    $('#ringFg').style.strokeDashoffset = String(97.39 * (1 - pct));
    $('#progressTxt').textContent = done + '/' + vis.length;
  }

  function sleeping() {
    return state.tasks.filter(function (t) { return t.sleeping; });
  }

  function updateSleepingHint() {
    var n = sleeping().length;
    var hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    $('#brandSub').textContent = n ? hoje + ' · ' + n + ' em descanso' : hoje;
  }

  /* ---------------- colunas ---------------- */

  function wireColumn(sec, col, body) {
    var titleEl = $('.col-title', sec);
    titleEl.addEventListener('change', function () {
      col.title = titleEl.value.trim() || 'Sem nome';
      titleEl.value = col.title;
      save();
    });
    titleEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    });

    $('.col-btn.add', sec).addEventListener('click', function () { openModal(null, col.id); });

    $('.col-btn.kill', sec).addEventListener('click', function () {
      if (state.columns.length <= 1) return toast('Precisa sobrar pelo menos uma coluna.');
      var n = state.tasks.filter(function (t) { return t.columnId === col.id; }).length;
      if (n && pendingKill !== col.id) {
        pendingKill = col.id;
        toast('“' + col.title + '” tem ' + n + ' tarefa(s). Clique de novo pra excluir tudo.');
        setTimeout(function () { if (pendingKill === col.id) pendingKill = null; }, 5000);
        return;
      }
      pendingKill = null;
      state.tasks = state.tasks.filter(function (t) { return t.columnId !== col.id; });
      state.columns = state.columns.filter(function (c) { return c.id !== col.id; });
      save(); render();
    });

    body.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      sec.classList.add('drop-target');
      var dragging = $('.card.dragging');
      if (!dragging) return;
      var empty = $('.col-empty', body);
      if (empty) empty.remove();
      var after = dragAfter(body, e.clientY);
      if (after == null) body.appendChild(dragging);
      else body.insertBefore(dragging, after);
    });
    body.addEventListener('dragleave', function (e) {
      if (!body.contains(e.relatedTarget)) sec.classList.remove('drop-target');
    });
    body.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  function dragAfter(body, y) {
    var cards = $$('.card:not(.dragging)', body).filter(function (c) { return !c.hidden; });
    var best = null, bestOffset = -Infinity;
    cards.forEach(function (c) {
      var box = c.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > bestOffset) { bestOffset = offset; best = c; }
    });
    return best;
  }

  function persistFromDOM() {
    var ordered = [];
    var sleepers = sleeping();
    $$('.col-body').forEach(function (body) {
      var col = colById(body.dataset.col);
      $$('.card', body).forEach(function (el) {
        var t = taskById(el.dataset.id);
        if (!t) return;
        if (t.columnId !== body.dataset.col) {
          var origem = t.columnId;
          t.columnId = body.dataset.col;
          if (col && col.done && !t.done) { t.prevColumn = origem; markDone(t); }
          else if (col && !col.done && t.done) markUndone(t);
        }
        ordered.push(t);
      });
    });
    ordered = ordered.concat(sleepers);
    if (ordered.length === state.tasks.length) state.tasks = ordered;
    save();
    render();
  }

  function addColumn() {
    var col = {
      id: Store.uid(),
      title: 'Nova coluna',
      accent: ACCENTS[state.columns.length % ACCENTS.length],
      done: false
    };
    state.columns.push(col);
    save(); render();
    var input = $('.column[data-col="' + col.id + '"] .col-title');
    if (input) { input.focus(); input.select(); }
    board.scrollLeft = board.scrollWidth;
  }

  /* ---------------- conclusão e sequência ---------------- */

  function markDone(t) {
    var today = todayISO();
    t._prevLastDone = t.lastDone || null;
    t._prevStreak = t.streak || 0;

    if (t.kind === 'diaria') {
      t.streak = (t.lastDone === addDays(today, -1)) ? (t.streak || 0) + 1 : 1;
    } else if (t.kind === 'semanal') {
      var lastWeek = addDays(weekStart(today), -7);
      t.streak = (t.lastDone && weekStart(t.lastDone) === lastWeek) ? (t.streak || 0) + 1 : 1;
    }

    t.lastDone = today;
    t.doneAt = today;
    t.done = true;
    logEvent('done', t, { cd: t.createdAt ? Store.isoOf(t.createdAt) : null, due: t.due || null });
  }

  function markUndone(t) {
    t.done = false;
    t.doneAt = null;
    if ('_prevLastDone' in t) {
      t.lastDone = t._prevLastDone;
      t.streak = t._prevStreak || 0;
      delete t._prevLastDone;
      delete t._prevStreak;
    }
    logEvent('undone', t);
  }

  function toggleDone(id) {
    var t = taskById(id);
    if (!t) return;
    var dc = doneColumn();

    if (!t.done) {
      if (dc && t.columnId !== dc.id) t.prevColumn = t.columnId;
      markDone(t);
      if (dc) t.columnId = dc.id;
      var sl = streakLabel(t);
      if (sl) toast('Sequência de ' + sl + ' em “' + t.title + '”.');
    } else {
      markUndone(t);
      if (dc && t.columnId === dc.id && t.prevColumn && colById(t.prevColumn)) {
        t.columnId = t.prevColumn;
        t.prevColumn = null;
      }
    }
    save(); render();
  }

  function shift(id, dir) {
    var t = taskById(id);
    if (!t) return;
    var i = state.columns.map(function (c) { return c.id; }).indexOf(t.columnId);
    var j = i + dir;
    if (j < 0 || j >= state.columns.length) return;
    var alvo = state.columns[j];
    if (alvo.done && !t.done) { t.prevColumn = t.columnId; markDone(t); }
    else if (!alvo.done && t.done) markUndone(t);
    t.columnId = alvo.id;
    save(); render();
  }

  /* ---------------- modal de tarefa ---------------- */

  function segValue(id) {
    var on = $('#' + id + ' .is-on');
    return on ? on.dataset.val : null;
  }
  function setSeg(id, val) {
    $$('#' + id + ' button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.val === val); });
  }
  function syncKindUI() {
    var k = segValue('fKind');
    $('#kindHint').textContent = KIND_HINT[k];
    $('#dueField').hidden = k !== 'unica';   // prazo só faz sentido em tarefa única
  }

  function openModal(id, presetCol) {
    editingId = id || null;
    var t = id ? taskById(id) : null;

    $('#modalTitle').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
    $('#btnDelete').hidden = !t;
    $('#btnDelete').dataset.armed = '';
    $('#btnDelete').textContent = 'Excluir';

    var sel = $('#fColumn');
    sel.innerHTML = state.columns.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.title) + '</option>';
    }).join('');

    $('#fTitle').value = t ? t.title : '';
    $('#fNotes').value = t ? (t.notes || '') : '';
    $('#fDue').value = t && t.due ? t.due : '';
    $('#fTags').value = t ? t.tags.join(', ') : '';
    $('#clientList').innerHTML = state.clients.map(function (c) {
      return '<option value="' + esc(c.name) + '">';
    }).join('');
    $('#fClient').value = t ? (clientName(t.client) || '') : '';
    sel.value = t ? t.columnId : (presetCol || state.columns[0].id);
    setSeg('fKind', t ? t.kind : (filters.view === 'rotinas' ? 'diaria' : 'unica'));
    setSeg('fPriority', t ? t.priority : 'media');
    syncKindUI();

    modal.hidden = false;
    setTimeout(function () { $('#fTitle').focus(); }, 30);
  }

  function closeModal() { modal.hidden = true; editingId = null; }

  function submit(e) {
    e.preventDefault();
    var title = $('#fTitle').value.trim();
    if (!title) return;

    var kind = segValue('fKind');
    var colId = $('#fColumn').value;
    var col = colById(colId);

    var data = {
      title: title,
      notes: $('#fNotes').value.trim(),
      kind: kind,
      due: kind === 'unica' ? ($('#fDue').value || null) : null,
      tags: $('#fTags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      client: (function () {
        var nome = $('#fClient').value.trim();
        if (!nome) return null;
        var c = Clients.ensure(state, nome);   // cria na hora se for nome novo
        return c ? c.id : null;
      })(),
      priority: segValue('fPriority'),
      columnId: colId
    };

    if (editingId) {
      var t = taskById(editingId);
      Object.keys(data).forEach(function (k) { t[k] = data[k]; });
      if (col && col.done && !t.done) markDone(t);
      if (col && !col.done && t.done) markUndone(t);
    } else {
      data.id = Store.uid();
      data.done = false;
      data.doneAt = null;
      data.lastDone = null;
      data.streak = 0;
      data.sleeping = false;
      data.prevColumn = null;
      data.createdAt = Date.now();
      state.tasks.push(data);
      logEvent('created', data);
      if (col && col.done) { data.prevColumn = state.columns[0].id; markDone(data); }
    }

    save(); closeModal(); render();
  }

  /* ---------------- histórico ---------------- */

  function openHistory() {
    var body = $('#histBody');
    var html = '';

    var zzz = sleeping();
    if (zzz.length) {
      html += '<h3 class="hist-h">Em descanso <small>voltam sozinhas na segunda</small></h3>';
      zzz.forEach(function (t) {
        html += '<div class="hist-row">' +
          '<div><strong>' + esc(t.title) + '</strong>' +
          '<small>' + KIND_LABEL[t.kind] + ' · concluída ' + prettyDate(t.doneAt) +
          (streakLabel(t) ? ' · sequência de ' + streakLabel(t) : '') + '</small></div>' +
          '<button class="btn ghost sm" data-wake="' + t.id + '">Acordar</button>' +
        '</div>';
      });
    }

    if (state.archive.length) {
      html += '<h3 class="hist-h">Arquivadas <small>' + state.archive.length + ' tarefa(s) única(s)</small></h3>';
      var lastDate = null;
      state.archive.forEach(function (a) {
        if (a.doneAt !== lastDate) {
          lastDate = a.doneAt;
          html += '<div class="hist-date">' + prettyDate(a.doneAt) + '</div>';
        }
        html += '<div class="hist-row done">' +
          '<div><strong>' + esc(a.title) + '</strong>' +
          (a.tags.length ? '<small>' + a.tags.map(esc).join(' · ') + '</small>' : '') + '</div>' +
          '<button class="btn ghost sm" data-restore="' + a.id + '">Restaurar</button>' +
        '</div>';
      });
    }

    if (!html) html = '<p class="hist-empty">Nada por aqui ainda. Tarefas únicas concluídas aparecem aqui depois da virada do dia.</p>';

    body.innerHTML = html;
    $('#btnClearHist').hidden = !state.archive.length;
    $('#btnClearHist').dataset.armed = '';
    $('#btnClearHist').textContent = 'Limpar histórico';
    history.hidden = false;
  }

  $('#histBody') && $('#histBody').addEventListener('click', function (e) {
    var wake = e.target.closest('[data-wake]');
    var rest = e.target.closest('[data-restore]');
    if (wake) {
      var t = taskById(wake.dataset.wake);
      if (t) { revive(t); save(); render(); openHistory(); toast('Rotina de volta ao quadro.'); }
    } else if (rest) {
      var i = -1;
      state.archive.forEach(function (a, k) { if (a.id === rest.dataset.restore) i = k; });
      if (i < 0) return;
      var a = state.archive.splice(i, 1)[0];
      state.tasks.push({
        id: a.id, columnId: state.columns[0].id, title: a.title, notes: a.notes,
        kind: a.kind, priority: a.priority, tags: a.tags, due: null,
        done: false, doneAt: null, lastDone: null, streak: 0, sleeping: false,
        prevColumn: null, createdAt: Date.now()
      });
      save(); render(); openHistory(); toast('Tarefa restaurada em “' + state.columns[0].title + '”.');
    }
  });

  /* ---------------- desempenho ---------------- */

  function openStats() {
    $('#statsBody').innerHTML = Stats.html(state, statsDays, statsUteis);
    stats.hidden = false;
  }

  $('#statsBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-days]');
    if (b) { statsDays = parseInt(b.dataset.days, 10); return openStats(); }
    var u = e.target.closest('[data-uteis]');
    if (u) { statsUteis = u.dataset.uteis === '1'; openStats(); }
  });
  $('#btnCloseStats').addEventListener('click', function () { stats.hidden = true; });
  stats.addEventListener('click', function (e) { if (e.target === stats) stats.hidden = true; });

  /* ---------------- menu de dados ---------------- */

  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function handleMenu(act) {
    if (act === 'clientes') {
      menu.hidden = true;
      setView('clientes');
    } else if (act === 'stats') {
      menu.hidden = true;
      openStats();
    } else if (act === 'history') {
      menu.hidden = true;
      openHistory();
    } else if (act === 'export') {
      menu.hidden = true;
      download('tasks-seven-' + todayISO() + '.json', Store.export(state));
      toast('Backup exportado.');
    } else if (act === 'import') {
      menu.hidden = true;
      $('#fileImport').click();
    } else if (act === 'archive-done') {
      menu.hidden = true;
      var n = 0;
      state.tasks.slice().forEach(function (t) {
        if (!t.done) return;
        if (t.kind === 'unica') { archive(t); n++; }
        else { t.sleeping = t.kind === 'semanal'; if (!t.sleeping) revive(t); n++; }
      });
      save(); render();
      toast(n ? n + ' tarefa(s) tirada(s) do quadro.' : 'Nada concluído pra arquivar.');
    } else if (act === 'reset') {
      if (menu.dataset.armed !== '1') {
        menu.dataset.armed = '1';
        toast('Isso apaga tudo, inclusive o histórico. Clique em “Zerar quadro” de novo pra confirmar.');
        setTimeout(function () { menu.dataset.armed = ''; }, 6000);
        return;
      }
      menu.dataset.armed = '';
      menu.hidden = true;
      state = Store.reset();
      state.lastRollover = todayISO();
      save(); render();
      toast('Quadro zerado.');
    }
  }

  /* ---------------- eventos globais ---------------- */

  $('#btnNew').addEventListener('click', function () {
    if (view === 'clientes') openClient(null);
    else openModal(null);
  });
  $('#btnCancel').addEventListener('click', closeModal);
  $('#btnClose').addEventListener('click', closeModal);
  $('#taskForm').addEventListener('submit', submit);
  $('#btnCloseHist').addEventListener('click', function () { history.hidden = true; });

  $('#btnClearHist').addEventListener('click', function () {
    var btn = $('#btnClearHist');
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Confirmar: apagar histórico';
      return;
    }
    state.archive = [];
    save(); openHistory();
    toast('Histórico apagado.');
  });

  $('#btnDelete').addEventListener('click', function () {
    var btn = $('#btnDelete');
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Confirmar exclusão';
      return;
    }
    var alvo = taskById(editingId);
    if (alvo) logEvent('deleted', alvo);
    state.tasks = state.tasks.filter(function (t) { return t.id !== editingId; });
    save(); closeModal(); render();
  });

  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  history.addEventListener('click', function (e) { if (e.target === history) history.hidden = true; });

  $$('.seg').forEach(function (seg) {
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      $$('button', seg).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      if (seg.id === 'fKind') syncKindUI();
    });
  });

  $('#search').addEventListener('input', function (e) {
    filters.q = e.target.value.trim().toLowerCase();
    render();
  });

  $$('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $$('.chip').forEach(function (c) { c.classList.toggle('is-on', c === chip); });
      filters.view = chip.dataset.view;
      render();
    });
  });

  $('#btnMenu').addEventListener('click', function (e) {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) handleMenu(b.dataset.act);
  });
  document.addEventListener('click', function (e) {
    if (!menu.hidden && !menu.contains(e.target) && !$('#btnMenu').contains(e.target)) menu.hidden = true;
  });

  $('#fileImport').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        state = Store.import(reader.result);
        rollover(); save(); render();
        toast('Backup importado.');
      } catch (err) {
        toast('Arquivo inválido.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (!modal.hidden) closeModal();
      else if (!clientModal.hidden) closeClient();
      else if (!stats.hidden) stats.hidden = true;
      else if (!history.hidden) history.hidden = true;
      else if (!menu.hidden) menu.hidden = true;
      else if (typing) document.activeElement.blur();
      return;
    }
    if (typing) return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      if (view === 'clientes') openClient(null); else openModal(null);
    }
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); openHistory(); }
    if (e.key === 'd' || e.key === 'D') { e.preventDefault(); openStats(); }
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); setView(view === 'clientes' ? 'tarefas' : 'clientes'); }
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  });

  // o app pode ficar aberto a noite toda: reavalia o ciclo ao voltar pra aba
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && rollover()) render();
  });
  setInterval(function () { if (rollover()) render(); }, 60000);

  /* ---------------- start ---------------- */

  rollover();
  save();      // grava migrações e a carteira inicial já na abertura
  render();
})();
