/* ============================================================
   TASKS SEVEN — análise de desempenho e entrega

   Tudo aqui é derivado de state.log (registro append-only de
   eventos: created / done / undone / archived / deleted).
   Nada é inferido do estado atual do quadro, porque o estado
   atual não sabe o que aconteceu ontem.

   Limite honesto: só mede o que passou pelo quadro, e só a
   partir do dia em que o registro começou.
   ============================================================ */
(function (global) {
  'use strict';

  function iso(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function todayISO() { return iso(new Date()); }
  function addDays(isoStr, n) {
    var d = new Date(isoStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return iso(d);
  }
  function diff(a, b) {   // dias de a até b
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }
  function weekStart(isoStr) {
    var d = new Date(isoStr + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(n) { return Math.round(n * 100); }
  function num(n, casas) {
    var f = Math.pow(10, casas || 0);
    return String(Math.round(n * f) / f).replace('.', ',');
  }
  var DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var KIND_LABEL = { unica: 'única', diaria: 'diária', semanal: 'semanal' };

  /* ---------------- cálculo ---------------- */

  function ehFimDeSemana(isoStr) {
    var wd = new Date(isoStr + 'T12:00:00').getDay();
    return wd === 0 || wd === 6;
  }

  function compute(state, days, uteis) {
    var today = todayISO();
    var from = addDays(today, -(days - 1));
    var log = (state.log || []).filter(function (ev) { return ev.d >= from && ev.d <= today; });

    // conclusões líquidas: cada "desfiz" cancela uma conclusão do mesmo dia
    var dones = log.filter(function (e) { return e.e === 'done'; }).slice();
    log.filter(function (e) { return e.e === 'undone'; }).forEach(function (u) {
      for (var i = 0; i < dones.length; i++) {
        if (dones[i].id === u.id && dones[i].d === u.d) { dones.splice(i, 1); return; }
      }
    });

    var criadas = log.filter(function (e) { return e.e === 'created'; }).length;

    // janela efetiva: não dá pra cobrar média de dias anteriores ao registro
    var primeiro = (state.log && state.log.length) ? state.log[0].d : today;
    var desde = primeiro > from ? primeiro : from;
    var janela = Math.max(1, diff(desde, today) + 1);

    var porDia = {};
    for (var k = 0; k < days; k++) porDia[addDays(from, k)] = 0;
    dones.forEach(function (e) { if (e.d in porDia) porDia[e.d]++; });

    // ciclo das únicas (criação -> entrega)
    var ciclos = [];
    dones.forEach(function (e) {
      if (e.kind === 'unica' && e.cd) ciclos.push(Math.max(0, diff(e.cd, e.d)));
    });
    var ciclo = ciclos.length ? ciclos.reduce(function (a, b) { return a + b; }, 0) / ciclos.length : null;

    var comAtraso = dones.filter(function (e) { return e.due && e.d > e.due; }).length;
    var comPrazo = dones.filter(function (e) { return !!e.due; }).length;

    // aderência das rotinas que ainda existem no quadro
    var rotinas = [];
    var oportTotal = 0, cumpridoTotal = 0;
    state.tasks.forEach(function (t) {
      if (t.kind === 'unica') return;
      var nasceu = Store.isoOf(t.createdAt || Date.now());
      var ini = nasceu > from ? nasceu : from;
      if (ini > today) return;
      var opp;
      if (t.kind === 'diaria') {
        opp = 0;
        for (var dia = ini; dia <= today; dia = addDays(dia, 1)) {
          if (!uteis || !ehFimDeSemana(dia)) opp++;
        }
      } else {
        opp = 0;
        var w = weekStart(ini), fim = weekStart(today);
        while (w <= fim) { opp++; w = addDays(w, 7); }
      }
      var feito = dones.filter(function (e) { return e.id === t.id; }).length;
      if (feito > opp) feito = opp;
      oportTotal += opp; cumpridoTotal += feito;
      rotinas.push({ title: t.title, kind: t.kind, opp: opp, feito: feito,
                     rate: opp ? feito / opp : 0, streak: t.streak || 0 });
    });
    rotinas.sort(function (a, b) { return a.rate - b.rate; });

    // tarefas paradas no quadro
    var paradas = state.tasks.filter(function (t) { return !t.done && !t.sleeping && t.kind === 'unica'; })
      .map(function (t) { return { title: t.title, dias: diff(Store.isoOf(t.createdAt), today) }; })
      .filter(function (t) { return t.dias >= 5; })
      .sort(function (a, b) { return b.dias - a.dias; })
      .slice(0, 6);

    // onde foi o esforço
    var tags = {}, pri = { baixa: 0, media: 0, alta: 0 }, semana = [0, 0, 0, 0, 0, 0, 0], cli = {};
    dones.forEach(function (e) {
      if (e.cli) cli[e.cli] = (cli[e.cli] || 0) + 1;
      (e.tags || []).forEach(function (tg) { tags[tg] = (tags[tg] || 0) + 1; });
      if (e.pri in pri) pri[e.pri]++;
      semana[new Date(e.d + 'T12:00:00').getDay()]++;
    });
    var topTags = Object.keys(tags).map(function (k) { return { tag: k, n: tags[k] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 8);

    var porCliente = Object.keys(cli).map(function (k) { return { nome: k, n: cli[k] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 10);

    var melhorDia = null, maxDia = 0;
    semana.forEach(function (n, i) { if (n > maxDia) { maxDia = n; melhorDia = i; } });

    return {
      days: days, from: from, today: today, desde: desde, janela: janela, uteis: !!uteis,
      total: dones.length, criadas: criadas, porDia: porDia,
      unicas: dones.filter(function (e) { return e.kind === 'unica'; }).length,
      rotinasFeitas: dones.filter(function (e) { return e.kind !== 'unica'; }).length,
      media: dones.length / janela,
      ciclo: ciclo, ciclosN: ciclos.length,
      comAtraso: comAtraso, comPrazo: comPrazo,
      rotinas: rotinas, aderencia: oportTotal ? cumpridoTotal / oportTotal : null,
      oportTotal: oportTotal, cumpridoTotal: cumpridoTotal,
      paradas: paradas, topTags: topTags, pri: pri, porCliente: porCliente,
      melhorDia: maxDia >= 2 ? DIA_SEMANA[melhorDia] : null, melhorDiaN: maxDia,
      vazio: !dones.length && !criadas
    };
  }

  /* ---------------- desenho ---------------- */

  function chart(m) {
    var chaves = Object.keys(m.porDia).sort();
    var barras;

    if (m.days > 30) {                       // agrupa por semana quando o período é longo
      var sem = {};
      chaves.forEach(function (d) {
        var w = weekStart(d);
        sem[w] = (sem[w] || 0) + m.porDia[d];
      });
      barras = Object.keys(sem).sort().map(function (w) {
        var p = w.split('-');
        return { n: sem[w], rot: p[2] + '/' + p[1], titulo: 'semana de ' + p[2] + '/' + p[1] };
      });
    } else {
      barras = chaves.map(function (d) {
        var p = d.split('-');
        return { n: m.porDia[d], rot: p[2], titulo: p[2] + '/' + p[1],
                 hoje: d === m.today, futuro: d < m.desde };
      });
    }

    var max = barras.reduce(function (a, b) { return Math.max(a, b.n); }, 0) || 1;
    var passo = Math.ceil(barras.length / 12);

    return '<div class="chart">' + barras.map(function (b, i) {
      var h = b.n ? Math.max(6, (b.n / max) * 100) : 0;
      return '<div class="bar-wrap' + (b.futuro ? ' pre' : '') + '" title="' + b.titulo + ': ' + b.n + '">' +
        '<div class="bar' + (b.hoje ? ' hoje' : '') + '" style="height:' + h + '%">' +
          (b.n ? '<span>' + b.n + '</span>' : '') +
        '</div>' +
        '<small>' + (i % passo === 0 || b.hoje ? b.rot : '') + '</small>' +
      '</div>';
    }).join('') + '</div>';
  }

  function barra(rate) {
    var cor = rate >= 0.8 ? 'ok' : (rate >= 0.5 ? 'meio' : 'ruim');
    return '<div class="rate"><i class="' + cor + '" style="width:' + pct(rate) + '%"></i></div>';
  }

  function html(state, days, uteis) {
    var m = compute(state, days, uteis);
    var out = '';

    out += '<div class="stats-period">' +
      [7, 30, 90].map(function (d) {
        return '<button class="chip' + (d === days ? ' is-on' : '') + '" data-days="' + d + '">' + d + ' dias</button>';
      }).join('') + '</div>';

    if (m.vazio) {
      return out + '<p class="hist-empty">Ainda não há eventos suficientes neste período.<br>' +
        'O registro começou em ' + m.desde.split('-').reverse().join('/') + ' — cada tarefa criada e concluída ' +
        'a partir de agora vira dado aqui. Volte em uma semana.</p>';
    }

    var saldo = m.total - m.criadas;
    out += '<div class="stat-grid">' +
      card(m.total, 'entregues', m.unicas + ' única(s) · ' + m.rotinasFeitas + ' rotina(s)') +
      card(num(m.media, 1), 'por dia', 'em ' + m.janela + ' dia(s) de registro') +
      card(m.aderencia === null ? '—' : pct(m.aderencia) + '%', 'rotinas cumpridas',
           m.aderencia === null ? 'sem rotinas no período' : m.cumpridoTotal + ' de ' + m.oportTotal + ' oportunidades') +
      card(m.ciclo === null ? '—' : num(m.ciclo, 1) + 'd', 'ciclo médio',
           m.ciclo === null ? 'nenhuma única entregue' : 'da criação até a entrega') +
    '</div>';

    out += '<h3 class="hist-h">Entregas por dia</h3>' + chart(m);

    var linha = m.criadas + ' criada(s) contra ' + m.total + ' entregue(s) — ';
    linha += saldo > 0 ? 'você tirou ' + saldo + ' do quadro a mais do que colocou.'
           : (saldo < 0 ? 'o quadro cresceu ' + Math.abs(saldo) + ' tarefa(s) no período.'
                        : 'entrou e saiu na mesma proporção.');
    if (m.melhorDia) linha += ' Seu dia mais forte é ' + m.melhorDia + '.';
    out += '<p class="stat-note">' + linha + '</p>';

    if (m.rotinas.length) {
      out += '<h3 class="hist-h">Aderência das rotinas ' +
        '<small>da pior para a melhor · contando ' +
        '<button class="linkish" data-uteis="' + (m.uteis ? '0' : '1') + '">' +
        (m.uteis ? 'só dias úteis' : 'todos os dias') + '</button></small></h3>';
      out += m.rotinas.map(function (r) {
        return '<div class="hist-row">' +
          '<div><strong>' + esc(r.title) + '</strong>' +
          '<small>' + KIND_LABEL[r.kind] + ' · ' + r.feito + ' de ' + r.opp +
          (r.streak >= 2 ? ' · sequência de ' + r.streak : '') + '</small>' + barra(r.rate) + '</div>' +
          '<b class="rate-n">' + pct(r.rate) + '%</b>' +
        '</div>';
      }).join('');
    }

    if (m.porCliente.length) {
      var maxc = m.porCliente[0].n;
      out += '<h3 class="hist-h">Entregas por cliente</h3>';
      out += m.porCliente.map(function (c) {
        return '<div class="cli-row"><span>' + esc(c.nome) + '</span>' +
               '<div class="rate"><i class="meio" style="width:' + pct(c.n / maxc) + '%"></i></div>' +
               '<b>' + c.n + '</b></div>';
      }).join('');
    }

    if (m.topTags.length || m.pri.alta) {
      out += '<h3 class="hist-h">Onde foi o esforço</h3><div class="tag-cloud">';
      out += m.topTags.map(function (t) {
        return '<span class="tag big">' + esc(t.tag) + ' <b>' + t.n + '</b></span>';
      }).join('');
      out += '<span class="tag big pri-alta">prioridade alta <b>' + m.pri.alta + '</b></span>';
      out += '</div>';
    }

    var alertas = '';
    if (m.comPrazo) {
      alertas += '<li><b>' + m.comAtraso + ' de ' + m.comPrazo + '</b> entrega(s) com prazo saíram atrasadas' +
                 (m.comAtraso ? '.' : ' — nenhuma furou o prazo.') + '</li>';
    }
    m.paradas.forEach(function (p) {
      alertas += '<li>“' + esc(p.title) + '” está parada no quadro há <b>' + p.dias + ' dias</b>.</li>';
    });
    if (alertas) out += '<h3 class="hist-h">Atenção</h3><ul class="alertas">' + alertas + '</ul>';

    out += '<p class="stat-foot">Isto mede <b>vazão</b>: o que passou pelo quadro. Não mede o peso nem o resultado ' +
           'de cada tarefa — uma semana de 30 entregas pequenas aparece maior que uma de 3 decisivas.</p>';

    return out;
  }

  function card(valor, rotulo, nota) {
    return '<div class="stat"><b>' + valor + '</b><span>' + rotulo + '</span><small>' + nota + '</small></div>';
  }

  global.Stats = { compute: compute, html: html };
})(window);
