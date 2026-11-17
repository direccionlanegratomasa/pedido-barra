/**
 * cruce_barra_agora.gs  ·  archivo propio del Apps Script «Ventas La Negra Tomasa»
 * ------------------------------------------------------------------------------
 * CRUCE SEMANAL: botellas que SALEN del almacén (Pedido de Barra) frente a las
 * que DEBERÍAN haberse gastado según lo vendido en Ágora.
 *
 *   Consumo teórico de una botella = Σ (unidades vendidas × cl por unidad) ÷ cl de la botella
 *   Dosis (decisión de Jorge, 17/11/2026): copa/combinado 6 cl · chupito 4 cl · cóctel 6 cl
 *
 * Usa: agora_informes (agoraCarpeta_), agora_semanal (semanalArchivo_,
 * semanalValoresXlsx_, semanalSumarDias_, semanalLunes_) y yurest_pedido_barra
 * (PBY: datos de Firebase). No escribe nada en la web de barra.
 *
 * Hoja de Google «Cruce barra · Ágora vs almacén» (se crea sola):
 *   · Botellas       botella del catálogo y cl que trae (70 por defecto)
 *   · Equivalencias  producto de Ágora → botella + cl por unidad vendida.
 *                    Fila sin botella = no lleva alcohol de almacén (no cuenta).
 *                    Un cóctel con dos alcoholes = dos filas con el mismo producto.
 *   · Semana …       resultado de cada semana
 * Cada lunes ~09:00 calcula la semana anterior (lunes a domingo), añade la
 * pestaña y manda un correo con lo que no cuadra.
 *
 * Funciones para ejecutar a mano:
 *   cruceProponer     crea/completa la hoja con una propuesta (últimas 4 semanas)
 *   crucePrueba       calcula los últimos 7 días SIN correo (para ver cómo sale)
 *   cruceSemanal      la del reloj: semana anterior + correo
 *   cruceProgramar    UNA vez: reloj de los lunes
 * Propiedades opcionales: CRUCE_DESTINATARIOS (correos separados por comas;
 * por defecto, el dueño del script) y CRUCE_HOJA (id de la hoja; se guarda sola).
 */

var CRUCE = {
  CL: { copa: 6, chupito: 4, coctel: 6, copaVino: 15 },
  AVISO_BOTELLAS: 1,     // diferencia mínima para avisar (botellas)
  AVISO_PCT: 0.2,        // y además ≥ 20 % del consumo teórico
  INICIO_SALIDAS: '2026-11-17',   // desde aquí las salidas se escanean
  SIN_MARCA: 'COPA SIN MARCA',   // copas de promotores, dobles, chupitos sin marca: se comparan en el TOTAL
  PROMOTORES: ['JAIME', 'ROCO', 'DAVID', 'RODOLFO', 'JUSTO'],
  COCTELES: [            // nombre en Ágora → alcohol propuesto (propuesta: revisar)
    ['CAIPIROSCA', 'VH HAUPOLD'], ['CAIPIRINHA', 'CACHAZA'], ['CAIPIRIÑA', 'CACHAZA'], ['APEROL', 'APEROL'],
    ['MARGARITA', 'OLMECA BLANCO'], ['MOJITO', 'LEGENDARIO BLANCO'], ['PIÑA COLADA', 'LEGENDARIO BLANCO'], ['PINA COLADA', 'LEGENDARIO BLANCO'],
    ['DAIQUIRI', 'LEGENDARIO BLANCO'], ['CUBA LIBRE', 'LEGENDARIO BLANCO'], ['CUBANITO', 'LEGENDARIO BLANCO'], ['COCO LOCO', 'LEGENDARIO BLANCO'],
    ['COSMOPOLITAN', 'VH HAUPOLD'], ['NEGRONI', 'CAMPARI'], ['SEX ON THE BEACH', 'VH HAUPOLD'], ['ESPRESSO MARTINI', 'VH HAUPOLD'],
    ['EXPRESSO MARTINI', 'VH HAUPOLD'], ['PISCO SOUR', 'ACHOLADO DEMONIO DE LOS ANDES'], ['OLD FASHION', 'JIM BEAM'], ['HUGO', 'SAINT GERMAIN ELDERFLOWER']
  ],
  COPAS_VINO: [          // copa de vino de la casa → botella propuesta (revisar)
    ['COPA VERDEJO', 'VIÑA ARNAIZ RUEDA VERDEJO'], ['COPA RIBERA', 'BOSCO ROBLE'],
    ['COPA ALBARIÑO', 'LAGAR DE PINTOS ALBARIÑO'], ['COPA RIOJA', 'AMADORA RIOJA']
  ],
  SOLO_FRASE: { 'LICOR CAFE': ['LICOR CAFE', 'LICOR DE CAFE'] },   // solo con la frase completa (no «CAFÉ SOLO»)
  ALIAS: {               // otras formas de escribir la botella en Ágora
    'JOHNIE WALKER BLACK LABEL': ['BLACK LABEL', 'JOHNNIE WALKER BLACK', 'JW BLACK', 'JOHNNIE WALKER NEGRA'],
    'JOHNIE WALKER RED LABEL': ['RED LABEL', 'JOHNNIE WALKER RED', 'JW RED', 'JOHNNIE WALKER ROJA'],
    'DEWARS': ['WHITE LABEL'], 'J&B': ['JB'], 'MACALLAN 12': ['MACALLAN'], 'PUERTO DE INDIAS FRESA': ['PUERTO DE INDIAS'],
    'BEEFEATER': ['BEEFETER'], 'LAGAR DE PINTOS ALBARIÑO': ['LAGAR DE PINTOS'], 'TARZUS CRIANZA': ['TARSUS', 'TARZUS'],
    'VIÑA ARNAIZ RUEDA VERDEJO': ['ARNAIZ'], 'BAIGORRIA RIOJA': ['BAIGORRI'], 'RUA VIEJA CREMA': ['RUAVIEJA CREMA'],
    'RUA VIEJA HIERBAS': ['RUAVIEJA HIERBAS', 'RUAVIEJA HIERVAS'], 'CARMELO ROMERO RIBERA': ['CARMELO RODERO'], 'MATAROMERAS RIOJA': ['MATARROMERA'],
    'BOMBAY SAPPIRE': ['SAPPHIRE', 'SAPHIRE'], 'BOMBAY LONDON': ['BOMBAY DRY', 'BOMBAY LONDON'],
    'HABANA 3': ['HAVANA 3', 'HAVANA CLUB 3'], 'HABANA 7': ['HAVANA 7', 'HAVANA CLUB 7'],
    'HABANA AÑEJO ORIGEN': ['HAVANA ORIGEN', 'HAVANA ANEJO ORIGEN', 'HABANA ORIGEN'],
    'VH HAUPOLD': ['HAUPOLD'], 'CUTTY SART': ['CUTTY SARK', 'CUTTY'], 'SEAGRAMS': ["SEAGRAM'S", 'SEAGRAM'],
    'JAGERMEISTER': ['JAGER', 'JAGGER'], 'BOSCO ROBLE': ['BOCOS'], 'LICOR TRIPLE MARIE BRIZAR': ['TRIPLE SECO', 'MARIE BRIZARD'],
    'TEQUILA DON JULIO BLANCO': ['DON JULIO BLANCO'], 'TEQUILA DON JULIO REPOSADO': ['DON JULIO REPOSADO'],
    'ACHOLADO DEMONIO DE LOS ANDES': ['DEMONIO DE LOS ANDES', 'PISCO'], 'MOET CHANDON BRUT': ['MOET'],
    'MUM CHAMPAGNE': ['MUMM', 'CORDON ROUGE'], 'YZAGUIRRE': ['VERMUT', 'VERMOUTH', 'IZAGUIRRE'], 'GIN MG': ['MG']
  },
  SIN_ALCOHOL: ['PURE POLOT', 'ZUMO DE LIMA', 'TORO ENERGETICO', 'SIROPE'],   // botellas que no se cruzan
  CL_BOTELLA: { 'CAMPARI': 100, 'CACHAZA': 100, 'VH HAUPOLD': 100, 'YZAGUIRRE': 100 },
  VINOS: ['RIOJA', 'RIBERA', 'ROBLE', 'VERDEJO', 'ALBARIÑO', 'GODELLO', 'ROSADO', 'CRIANZA', 'BRUT', 'CHAMPAGNE', 'ROGER DE FLOR', 'VIÑA', 'TARZUS', 'MATAROMERAS', 'AZPILICUETA', 'AMADORA', 'OBALO', 'TRESOLMOS', 'GODELIA', 'BAIGORRIA', 'CARMELO', 'PAGO DE']
};

// ===================== Funciones para el editor =====================

function cruceProponer(){
  var hoy = Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
  var desde = semanalSumarDias_(hoy, -28), hasta = semanalSumarDias_(hoy, -1);
  var ventas = cruceVentasRango_(desde, hasta);
  var botellas = cruceBotellasCatalogo_();
  var ss = cruceHoja_();
  cruceEscribirBotellas_(ss, botellas);
  var nuevas = cruceCompletarEquivalencias_(ss, ventas.productos, botellas.concat([CRUCE.SIN_MARCA]), 'propuesta automática');
  Logger.log('Hoja: ' + ss.getUrl());
  Logger.log('Días leídos de Ágora: ' + ventas.dias + ' (' + desde + ' a ' + hasta + '); faltan: ' + (ventas.faltan.join(', ') || 'ninguno'));
  Logger.log('Productos de Ágora añadidos a «Equivalencias»: ' + nuevas);
}

/** Borra «Equivalencias» y vuelve a proponer. SOLO antes de revisar la hoja: se pierde lo cambiado a mano. */
function cruceRehacerPropuesta(){
  var h = cruceHoja_().getSheetByName('Equivalencias');
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, h.getLastColumn()).clearContent();
  cruceProponer();
}

function crucePrueba(){
  var hoy = Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
  var r = cruceCalcular_(semanalSumarDias_(hoy, -7), semanalSumarDias_(hoy, -1));
  cruceEscribirResultado_(r, 'Prueba ' + r.desde.slice(5) + ' a ' + r.hasta.slice(5));
  Logger.log(cruceTexto_(r));
}

function cruceSemanal(){
  var hoy = Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
  var lunes = semanalSumarDias_(semanalLunes_(hoy), -7);
  var r = cruceCalcular_(lunes, semanalSumarDias_(lunes, 6));
  var url = cruceEscribirResultado_(r, 'Semana ' + lunes);
  var props = PropertiesService.getScriptProperties();
  var para = props.getProperty('CRUCE_DESTINATARIOS') || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: para,
    subject: 'Cruce barra · semana del ' + cruceFecha_(r.desde) + ' al ' + cruceFecha_(r.hasta) + (r.avisos.length ? ' · ' + r.avisos.length + ' botellas no cuadran' : ' · todo cuadra'),
    body: cruceTexto_(r) + '\n\nDetalle completo: ' + url
  });
}

function cruceProgramar(){
  ScriptApp.getProjectTriggers().filter(function(t){ return t.getHandlerFunction() === 'cruceSemanal'; })
    .forEach(function(t){ ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cruceSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(15).inTimezone('Europe/Madrid').create();
  Logger.log('Reloj creado: cruceSemanal los lunes hacia las 09:15.');
}

// ===================== Cálculo =====================

function cruceCalcular_(desde, hasta){
  var ss = cruceHoja_();
  var botellas = cruceLeerBotellas_(ss);
  var equiv = cruceLeerEquivalencias_(ss);
  var ventas = cruceVentasRango_(desde, hasta);
  // productos de Ágora que nunca se han revisado: se añaden a la hoja para que no se escapen
  var nuevos = cruceCompletarEquivalencias_(ss, ventas.productos, cruceBotellasCatalogo_().concat([CRUCE.SIN_MARCA]), 'NUEVO: revisar');
  var salidas = cruceSalidas_(desde, hasta);
  return cruceComparar_(desde, hasta, ventas, salidas, botellas, equiv, nuevos);
}

/** Puro: compara consumo teórico y salidas por botella. */
function cruceComparar_(desde, hasta, ventas, salidas, botellas, equiv, nuevos){
  var teo = {}, origen = {};
  Object.keys(ventas.productos).forEach(function(p){
    (equiv[cruceNorm_(p)] || []).forEach(function(e){
      if (!e.botella || !(e.cl > 0)) return;
      var clb = botellas[e.botella] || 70;
      teo[e.botella] = (teo[e.botella] || 0) + ventas.productos[p] * e.cl / clb;
      (origen[e.botella] = origen[e.botella] || []).push(p + ' ×' + ventas.productos[p]);
    });
  });
  var bolsa = teo[CRUCE.SIN_MARCA] || 0; delete teo[CRUCE.SIN_MARCA];
  var nombres = {};
  Object.keys(teo).forEach(function(b){ nombres[b] = 1; });
  Object.keys(salidas).forEach(function(b){ if (botellas[b] !== undefined) nombres[b] = 1; });
  var filas = Object.keys(nombres).map(function(b){
    var t = Math.round((teo[b] || 0) * 10) / 10, s = salidas[b] || 0, d = Math.round((s - t) * 10) / 10;
    var aviso = Math.abs(d) >= CRUCE.AVISO_BOTELLAS && Math.abs(d) >= CRUCE.AVISO_PCT * Math.max(t, 1);
    return { botella: b, salidas: s, teorico: t, dif: d, pct: t > 0 ? d / t : null, aviso: aviso,
             nota: d > 0 ? 'salen más de las que se venden' : (d < 0 ? 'se vende más de lo que sale' : ''),
             origen: (origen[b] || []).join(', ') };
  }).sort(function(a, b){ return Math.abs(b.dif) - Math.abs(a.dif); });
  // TOTAL de destilados: aquí sí cuentan las copas sin marca (promotores, dobles)
  var esDest = function(b){ return !cruceEsVino_(b) && !CRUCE.SIN_ALCOHOL.some(function(x){ return cruceNorm_(b).indexOf(x) === 0; }); };
  var sT = 0, tT = bolsa;
  filas.forEach(function(f){ if (esDest(f.botella)){ sT += f.salidas; tT += f.teorico; } });
  tT = Math.round(tT * 10) / 10;
  var dT = Math.round((sT - tT) * 10) / 10;
  var total = { botella: 'TOTAL DESTILADOS (con ' + (Math.round(bolsa * 10) / 10) + ' bot. de copas sin marca)', salidas: sT, teorico: tT, dif: dT,
    pct: tT > 0 ? dT / tT : null, aviso: Math.abs(dT) >= 2 && Math.abs(dT) >= 0.1 * Math.max(tT, 1),
    nota: dT > 0 ? 'en total sale más alcohol del que se vende' : (dT < 0 ? 'en total se vende más de lo que sale' : ''), origen: '' };
  // una botella suelta con diferencia positiva puede ser alcohol servido en copas sin marca: no se marca si el TOTAL cuadra
  if (bolsa > 0 && !total.aviso) filas.forEach(function(f){ if (f.dif > 0 && esDest(f.botella)) f.aviso = false; });
  filas.unshift(total);
  return { desde: desde, hasta: hasta, filas: filas, bolsa: bolsa, avisos: filas.filter(function(f){ return f.aviso; }),
           diasAgora: ventas.dias, faltanAgora: ventas.faltan, nuevos: nuevos || 0,
           parcial: desde < CRUCE.INICIO_SALIDAS };
}

function cruceTexto_(r){
  var L = [];
  L.push('Cruce barra: salidas del almacén frente a lo vendido en Ágora');
  L.push('Del ' + cruceFecha_(r.desde) + ' al ' + cruceFecha_(r.hasta) + '. Dosis: copa 6 cl, chupito 4 cl, cóctel 6 cl.');
  if (r.parcial) L.push('Ojo: las salidas escaneadas empiezan el 17/11/2026; antes de esa fecha la comparación no vale.');
  if (r.faltanAgora.length) L.push('Faltan informes de Ágora de: ' + r.faltanAgora.join(', ') + ' (esos días no cuentan como venta).');
  if (r.nuevos) L.push(r.nuevos + ' productos nuevos de Ágora añadidos a «Equivalencias» sin asignar: revísalos.');
  if (r.bolsa) L.push('Copas sin marca (promotores, dobles, chupitos): ' + (Math.round(r.bolsa * 10) / 10) + ' botellas; solo se pueden comparar en el TOTAL.');
  L.push('');
  if (!r.avisos.length) L.push('Todo cuadra dentro del margen (±1 botella y 20 %).');
  else {
    L.push('No cuadran (' + r.avisos.length + '):');
    r.avisos.forEach(function(f){
      L.push('· ' + f.botella + ': salen ' + f.salidas + ', según ventas ' + f.teorico + ' → ' + (f.dif > 0 ? '+' : '') + f.dif + ' (' + f.nota + ')');
    });
  }
  L.push('');
  L.push('Recuerda: la barra guarda algo de stock propio, así que una semana suelta puede descuadrar un poco; lo que importa es que se repita.');
  return L.join('\n');
}

// ===================== Datos =====================

/** Unidades vendidas por producto de Ágora en un rango de días (Excel de Drive). */
function cruceVentasRango_(desde, hasta){
  var carpeta = agoraCarpeta_(), productos = {}, dias = 0, faltan = [];
  for (var d = desde; d <= hasta; d = semanalSumarDias_(d, 1)){
    var f = semanalArchivo_(carpeta, 'Ventas por Productos por Centro de Venta ' + d + '.xlsx');
    if (!f){ faltan.push(cruceFecha_(d)); continue; }
    var filas = cruceParsearProductos_(semanalValoresXlsx_(f.getId()));
    filas.forEach(function(x){ productos[x.nombre] = (productos[x.nombre] || 0) + x.uds; });
    dias++;
  }
  return { productos: productos, dias: dias, faltan: faltan };
}

/** Puro: filas de producto (nombre y unidades de todos los centros) del informe de Ágora. */
function cruceParsearProductos_(v){
  var s = function(i, j){ return String((v[i] || [])[j] === undefined ? '' : v[i][j]).trim(); };
  var n = function(i, j){ var x = (v[i] || [])[j]; if (typeof x === 'number') return x;
    var t = String(x || '').replace(/[€\s]/g, ''); if (!t) return 0;
    var c = t.lastIndexOf(','), p = t.lastIndexOf('.'); t = c > p ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    return Number(t) || 0; };
  var sub = -1, cols = [];
  for (var i = 0; i < Math.min(v.length, 30) && sub < 0; i++){
    var row = v[i] || [];
    for (var j = 1; j < row.length; j++){
      var a = s(i, j), b = s(i, j + 1);
      if (/cant(idad)?\.?$/i.test(a) && /ventas?/i.test(b)){
        var etiqueta = a.replace(/cant(idad)?\.?$/i, '').trim();
        if (!etiqueta){ for (var k = j; k >= 0 && !etiqueta; k--) etiqueta = s(i - 1, k); }
        cols.push({ col: j, total: /^total/i.test(etiqueta.split('/')[0].trim()) });
      }
    }
    if (cols.length) sub = i;
  }
  if (sub < 0) throw new Error('No encuentro las columnas «Cant.» del informe de Ágora.');
  var usar = cols.filter(function(c){ return !c.total; });
  var out = [];
  for (var f = sub + 1; f < v.length; f++){
    var nombre = s(f, 0);
    if (!nombre) continue;
    if (/^total(es)?$/i.test(nombre)) break;
    var u = usar.reduce(function(acc, c){ return acc + n(f, c.col); }, 0);
    if (u > 0) out.push({ nombre: nombre, uds: u });
  }
  return out;
}

/** Botellas que salieron del almacén (entregas confirmadas), por día de Madrid. */
function cruceSalidas_(desde, hasta){
  var url = 'https://firestore.googleapis.com/v1/projects/' + PBY.FIREBASE_PROYECTO +
    '/databases/(default)/documents/pedido-barra-data/stock-history?key=' + PBY.FIREBASE_CLAVE_WEB;
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return {};
  if (res.getResponseCode() !== 200) throw new Error('Firestore (histórico) respondió ' + res.getResponseCode());
  var f = JSON.parse(res.getContentText()).fields || {};
  var lista = JSON.parse((f.value && f.value.stringValue) || '[]'), out = {};
  lista.forEach(function(e){
    if (e.type !== 'salida' || !e.date) return;
    var dia = Utilities.formatDate(new Date(e.date), 'Europe/Madrid', 'yyyy-MM-dd');
    if (dia < desde || dia > hasta) return;
    out[e.product] = (out[e.product] || 0) + (Number(e.qty) || 0);
  });
  return out;
}

/** Bebidas del catálogo de Pedido de Barra (para la hoja «Botellas»). */
function cruceBotellasCatalogo_(){
  var out = [], token = '';
  do {
    var url = 'https://firestore.googleapis.com/v1/projects/' + PBY.FIREBASE_PROYECTO +
      '/databases/(default)/documents/pedido-barra-products?pageSize=300&key=' + PBY.FIREBASE_CLAVE_WEB + (token ? '&pageToken=' + token : '');
    var r = JSON.parse(UrlFetchApp.fetch(url).getContentText());
    (r.documents || []).forEach(function(d){
      var f = d.fields || {}, nombre = f.name && f.name.stringValue, cat = (f.category && f.category.stringValue) || 'bebida';
      if (nombre && cat === 'bebida') out.push(nombre);
    });
    token = r.nextPageToken || '';
  } while (token);
  return out.sort();
}

// ===================== Propuesta (puro) =====================

function cruceNorm_(s){
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function cruceEsVino_(b){ var n = cruceNorm_(b); return CRUCE.VINOS.some(function(w){ return n.indexOf(cruceNorm_(w)) >= 0; }); }
function cruceClBotellaDefecto_(b){ return CRUCE.CL_BOTELLA[b] || (cruceEsVino_(b) ? 75 : 70); }

/** Propone botella y cl para un producto de Ágora. {botella:'', cl:0, nota} si no lleva alcohol de almacén. */
function cruceProponer_(producto, botellas){
  var p = ' ' + cruceNorm_(producto) + ' ';
  var nada = { botella: '', cl: 0, nota: '' };
  if (/ SIN /.test(p) && !/ SIN GLUTEN /.test(p)) return { botella: '', cl: 0, nota: 'sin alcohol' };
  // copas de promotores, dobles y chupitos sin marca → bolsa común
  var prom = CRUCE.PROMOTORES.some(function(n){ return p.indexOf(' ' + n + ' ') === 0; });
  if ((prom && / COPA /.test(p)) || p === ' DOBLE ') return { botella: CRUCE.SIN_MARCA, cl: CRUCE.CL.copa, nota: 'copa sin marca (va al TOTAL)' };
  if (p === ' CHUPITO ') return { botella: CRUCE.SIN_MARCA, cl: CRUCE.CL.chupito, nota: 'chupito sin marca (va al TOTAL)' };
  if (prom) return nada;   // pases de cena, cervezas/refrescos de promotor: sin alcohol de almacén
  for (var v = 0; v < CRUCE.COPAS_VINO.length; v++){
    if (p.indexOf(' ' + cruceNorm_(CRUCE.COPAS_VINO[v][0]) + ' ') >= 0 && botellas.indexOf(CRUCE.COPAS_VINO[v][1]) >= 0)
      return { botella: CRUCE.COPAS_VINO[v][1], cl: CRUCE.CL.copaVino, nota: 'copa de vino de la casa 15 cl: revisar' };
  }
  var GENERICAS = ['GIN','RON','VODKA','TEQUILA','WHISKY','LICOR','COPA','CHUPITO','BOTELLA','BOT','DE','LA','LOS','EL','Y','BLANCO','REPOSADO','ANEJO'];
  var mejor = null;
  botellas.forEach(function(b){
    if (b === CRUCE.SIN_MARCA || CRUCE.SIN_ALCOHOL.some(function(x){ return cruceNorm_(b).indexOf(x) === 0; })) return;
    var estricta = !!CRUCE.SOLO_FRASE[b];
    var formas = estricta ? CRUCE.SOLO_FRASE[b] : [b].concat(CRUCE.ALIAS[b] || []);
    formas.forEach(function(forma){
      var toks = cruceNorm_(forma).split(' ').filter(function(t){ return t.length >= 2 && (estricta || GENERICAS.indexOf(t) < 0); });
      if (!toks.length) return;
      var ok = estricta ? p.indexOf(' ' + toks.join(' ') + ' ') >= 0 : toks.every(function(t){ return p.indexOf(' ' + t + ' ') >= 0; });
      // "BLANCO"/"REPOSADO"/"AÑEJO" distinguen botellas parecidas: si la botella lo lleva, el producto también
      var dist = ['BLANCO','REPOSADO','ANEJO','BLACK','RED'].filter(function(w){ return (' ' + cruceNorm_(forma) + ' ').indexOf(' ' + w + ' ') >= 0; });
      if (ok && dist.every(function(w){ return p.indexOf(' ' + w + ' ') >= 0; })){
        var peso = toks.join(' ').length + dist.length * 3;
        if (!mejor || peso > mejor.peso) mejor = { botella: b, peso: peso };
      }
    });
  });
  var esChupito = / (CHUPITO|SHOT) /.test(p), esBotella = / (BOTELLA|BOT) /.test(p);
  if (mejor){
    var b = mejor.botella;
    if (esBotella) return { botella: b, cl: cruceClBotellaDefecto_(b), nota: 'botella entera' };
    if (esChupito) return { botella: b, cl: CRUCE.CL.chupito, nota: 'chupito' };
    if (cruceEsVino_(b)) return { botella: b, cl: CRUCE.CL.copaVino, nota: 'copa de vino 15 cl: revisar' };
    return { botella: b, cl: CRUCE.CL.copa, nota: 'copa' };
  }
  for (var i = 0; i < CRUCE.COCTELES.length; i++){
    if (p.indexOf(' ' + cruceNorm_(CRUCE.COCTELES[i][0]) + ' ') >= 0){
      var base = CRUCE.COCTELES[i][1];
      return { botella: base && botellas.indexOf(base) >= 0 ? base : '', cl: CRUCE.CL.coctel,
               nota: base ? 'cóctel: revisar el alcohol' : 'cóctel: elige el alcohol de la casa' };
    }
  }
  return nada;
}

// ===================== Hoja de Google =====================

function cruceHoja_(){
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('CRUCE_HOJA');
  if (id){ try { return SpreadsheetApp.openById(id); } catch (e){} }
  var ss = SpreadsheetApp.create('Cruce barra · Ágora vs almacén');
  props.setProperty('CRUCE_HOJA', ss.getId());
  var h = ss.getSheets()[0]; h.setName('Equivalencias');
  h.getRange(1, 1, 1, 5).setValues([['Producto de Ágora', 'Botella del catálogo (vacío = no cuenta)', 'cl por unidad vendida', 'Uds vendidas (al añadirlo)', 'Nota']]).setFontWeight('bold');
  h.setFrozenRows(1); h.setColumnWidth(1, 320); h.setColumnWidth(2, 300); h.setColumnWidth(5, 260);
  var b = ss.insertSheet('Botellas');
  b.getRange(1, 1, 1, 2).setValues([['Botella del catálogo', 'cl por botella']]).setFontWeight('bold');
  b.setFrozenRows(1); b.setColumnWidth(1, 320);
  return ss;
}

function cruceEscribirBotellas_(ss, botellas){
  var h = ss.getSheetByName('Botellas'), ya = {};
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().forEach(function(r){ ya[r[0]] = 1; });
  var nuevas = botellas.filter(function(b){ return !ya[b] && !CRUCE.SIN_ALCOHOL.some(function(x){ return cruceNorm_(b).indexOf(x) === 0; }); })
    .map(function(b){ return [b, cruceClBotellaDefecto_(b)]; });
  if (!ya[CRUCE.SIN_MARCA]) nuevas.push([CRUCE.SIN_MARCA, 70]);
  if (nuevas.length) h.getRange(h.getLastRow() + 1, 1, nuevas.length, 2).setValues(nuevas);
  // desplegable de botellas en «Equivalencias»
  var eq = ss.getSheetByName('Equivalencias');
  var regla = SpreadsheetApp.newDataValidation().requireValueInRange(h.getRange('A2:A'), true).setAllowInvalid(false).build();
  eq.getRange('B2:B').setDataValidation(regla);
}

function cruceLeerBotellas_(ss){
  var h = ss.getSheetByName('Botellas'), out = {};
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, 2).getValues().forEach(function(r){ if (r[0]) out[r[0]] = Number(r[1]) || 70; });
  return out;
}

function cruceLeerEquivalencias_(ss){
  var h = ss.getSheetByName('Equivalencias'), out = {};
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, 3).getValues().forEach(function(r){
    if (!r[0]) return;
    var k = cruceNorm_(r[0]);
    (out[k] = out[k] || []).push({ botella: String(r[1] || '').trim(), cl: Number(r[2]) || 0 });
  });
  return out;
}

/** Añade a «Equivalencias» los productos de Ágora que aún no están (no toca los ya revisados). */
function cruceCompletarEquivalencias_(ss, productos, botellas, notaNuevo){
  var h = ss.getSheetByName('Equivalencias'), ya = {};
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().forEach(function(r){ ya[cruceNorm_(r[0])] = 1; });
  var filas = [];
  Object.keys(productos).sort(function(a, b){ return productos[b] - productos[a]; }).forEach(function(p){
    if (ya[cruceNorm_(p)]) return;
    var pr = cruceProponer_(p, botellas);
    filas.push([p, pr.botella, pr.botella || pr.nota ? pr.cl : '', productos[p], notaNuevo + (pr.nota ? ' · ' + pr.nota : '')]);
  });
  if (filas.length) h.getRange(h.getLastRow() + 1, 1, filas.length, 5).setValues(filas);
  return filas.length;
}

function cruceEscribirResultado_(r, nombre){
  var ss = cruceHoja_(), h = ss.getSheetByName(nombre);
  if (h) ss.deleteSheet(h);
  h = ss.insertSheet(nombre, 2);
  var cab = [['Botella', 'Salen del almacén', 'Según ventas de Ágora', 'Diferencia', '%', '¿No cuadra?', 'Qué significa', 'Ventas de Ágora que cuentan']];
  var filas = r.filas.map(function(f){ return [f.botella, f.salidas, f.teorico, f.dif, f.pct === null ? '' : f.pct, f.aviso ? 'SÍ' : '', f.nota, f.origen]; });
  h.getRange(1, 1, 1, 8).setValues(cab).setFontWeight('bold');
  if (filas.length){
    h.getRange(2, 1, filas.length, 8).setValues(filas);
    h.getRange(2, 5, filas.length, 1).setNumberFormat('0%');
    r.filas.forEach(function(f, i){ if (f.aviso) h.getRange(i + 2, 1, 1, 7).setFontWeight('bold').setBackground('#E6E6E6'); });
  }
  h.setFrozenRows(1); h.setColumnWidth(1, 300); h.setColumnWidth(7, 260); h.setColumnWidth(8, 500);
  h.getRange(filas.length + 3, 1).setValue(cruceTexto_(r));
  return ss.getUrl() + '#gid=' + h.getSheetId();
}

function cruceFecha_(d){ return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4); }
