/**
 * yurest_pedido_barra.gs
 * ------------------------------------------------------------------
 * Trae de Yurest los albaranes de compra de alcohol (proveedores
 * BORDINO y SUBMARINER) y los deja en la base de datos de la web
 * «Pedido de Barra» (Firestore, colección `pedido-barra-yurest`).
 *
 * La web los suma al stock sola: la primera vez que aparece un
 * producto de Yurest, el administrador dice a qué producto del
 * catálogo corresponde (y cuántas unidades trae cada formato). A partir
 * de ahí, los albaranes siguientes se suman sin tocar nada.
 *
 * Va en su PROPIO archivo del Apps Script (no en Codigo.gs). Todas las
 * funciones empiezan por `pbYurest` para no chocar con nada existente.
 *
 * Propiedades del script (las mismas que ya usa Servicios/Gastos):
 *   YUREST_TOKEN   token de integración (X-Provider-Token)
 *   YUREST_EMAIL   usuario de Yurest con acceso a la API
 *   YUREST_CLAVE   contraseña de ese usuario
 * Opcionales:
 *   PB_YUREST_DESDE        AAAA-MM-DD. No se traen albaranes creados antes
 *                          de esta fecha. Si no existe, se fija sola al día
 *                          de la primera sincronización (no carga histórico).
 *   PB_YUREST_PROVEEDORES  lista separada por comas. Por defecto
 *                          "BORDINO,SUBMARINER" (se busca dentro del nombre
 *                          del proveedor, sin mayúsculas ni acentos).
 *
 * Funciones para ejecutar a mano:
 *   pbYurestProbar       Solo lectura: dice qué proveedores y albaranes ve.
 *   pbYurestSincronizar  Una pasada real (la que ejecuta el reloj).
 *   pbYurestProgramar    UNA vez: reloj cada 15 minutos.
 *   pbYurestParar        Quita el reloj.
 *
 * Sin claves en este archivo: la clave de Firebase de abajo es la misma
 * que ya está publicada en la página (es pública por diseño).
 */

const PBY = {
  YUREST_URL: 'https://cliente.yurest.com/ws',
  FIREBASE_PROYECTO: 'pedido-barra',
  FIREBASE_CLAVE_WEB: 'AIzaSyDovM-G_cryfjg-Vaf2dBpcKXvXgHyD_pk',
  COLECCION: 'pedido-barra-yurest',
  DIAS_ATRAS: 14,                 // ventana que se revisa en cada pasada
  PROVEEDORES_DEFECTO: 'BORDINO,SUBMARINER',
  PROP_SESION: 'PB_YUREST_SESION' // token de sesión de Yurest (24 h deslizantes)
};

// ===================== Funciones para el editor =====================

function pbYurestProbar(){
  const props = PropertiesService.getScriptProperties();
  const faltan = ['YUREST_TOKEN','YUREST_EMAIL','YUREST_CLAVE'].filter(k=>!props.getProperty(k));
  if(faltan.length){ Logger.log('Faltan propiedades: ' + faltan.join(', ')); return; }

  const hoy = pbYurestHoy_();
  const desde = pbYurestSumarDias_(hoy, -PBY.DIAS_ATRAS);
  const notas = pbYurestListar_(desde, hoy);
  const proveedores = {};
  notas.forEach(n=>{ const p = n.provider_name || '(sin proveedor)'; proveedores[p] = (proveedores[p]||0) + 1; });
  Logger.log('Albaranes en Yurest del ' + desde + ' al ' + hoy + ': ' + notas.length);
  Object.keys(proveedores).sort().forEach(p=>{
    Logger.log('  ' + (pbYurestEsProveedor_(p) ? '✔ ' : '  ') + p + ': ' + proveedores[p]);
  });
  const nuestros = notas.filter(n=>pbYurestEsProveedor_(n.provider_name));
  Logger.log('De Bordino/Submariner: ' + nuestros.length + ' (✔ = se cargarán en Pedido de Barra)');
  if(nuestros.length){
    const d = pbYurestDetalle_(nuestros[0].id);
    const lineas = pbYurestLineas_(d);
    Logger.log('Ejemplo, albarán ' + nuestros[0].id + ' (' + (d.provider && d.provider.name) + ', ' + d.date + '):');
    lineas.forEach(l=>Logger.log('   ' + l.cantidad + ' × ' + l.nombre + (l.formato ? ' [' + l.formato + ']' : '')));
  }
  pbYurestFsLeer_('prueba-conexion'); // lanza error si la web no deja escribir/leer
  Logger.log('Firestore de Pedido de Barra: conexión correcta.');
}

function pbYurestSincronizar(){
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(20000)){ Logger.log('Otra sincronización en marcha; se omite.'); return; }
  try{
    const props = PropertiesService.getScriptProperties();
    const hoy = pbYurestHoy_();
    let desdeFijo = props.getProperty('PB_YUREST_DESDE');
    if(!desdeFijo){ desdeFijo = hoy; props.setProperty('PB_YUREST_DESDE', hoy); }
    let desde = pbYurestSumarDias_(hoy, -PBY.DIAS_ATRAS);
    if(desdeFijo > desde) desde = desdeFijo;

    const notas = pbYurestListar_(desde, hoy).filter(n=>pbYurestEsProveedor_(n.provider_name));
    let nuevos = 0, actualizados = 0, cambiados = 0;

    notas.forEach(n=>{
      const det = pbYurestDetalle_(n.id);
      const datos = {
        yurestId: n.id,
        proveedor: (det.provider && det.provider.name) || n.provider_name || '',
        referencia: det.reference || det.external_reference || n.external_ref || String(n.id),
        fecha: det.delivery_date || det.date || n.date || '',
        estadoYurest: (det.state && det.state.name) || n.state_name || '',
        tienda: (det.store && det.store.name) || n.store_name || '',
        lineas: pbYurestLineas_(det)
      };
      const huella = pbYurestHuella_(datos.lineas);
      const idDoc = 'alb-' + n.id;
      const actual = pbYurestFsLeer_(idDoc);

      if(!actual){
        pbYurestFsCrear_(idDoc, {
          estado: 'pendiente',
          datos: JSON.stringify(datos),
          huella: huella,
          importadoEn: new Date().toISOString(),
          cambiadoTrasAplicar: false
        });
        nuevos++;
        return;
      }
      if(actual.huella === huella) return;            // sin cambios
      if(actual.estado === 'pendiente'){
        pbYurestFsActualizar_(idDoc, { datos: JSON.stringify(datos), huella: huella });
        actualizados++;
      }else if(actual.estado === 'aplicado'){
        // Ya se sumó al stock y luego alguien lo cambió en Yurest: no se toca
        // el stock solo; se avisa en la web para que lo revise el admin.
        pbYurestFsActualizar_(idDoc, { datosNuevos: JSON.stringify(datos), huella: huella, cambiadoTrasAplicar: true });
        cambiados++;
      }
      // 'descartado': se ignora
    });

    Logger.log('Yurest → Pedido de Barra (' + desde + ' a ' + hoy + '): ' + notas.length +
      ' albaranes de Bordino/Submariner; nuevos ' + nuevos + ', actualizados ' + actualizados +
      ', cambiados tras sumar ' + cambiados + '.');
  }finally{
    lock.releaseLock();
  }
}

function pbYurestProgramar(){
  pbYurestParar();
  ScriptApp.newTrigger('pbYurestSincronizar').timeBased().everyMinutes(15).create();
  Logger.log('Reloj creado: pbYurestSincronizar cada 15 minutos.');
  pbYurestSincronizar();
}

function pbYurestParar(){
  ScriptApp.getProjectTriggers()
    .filter(t=>t.getHandlerFunction()==='pbYurestSincronizar')
    .forEach(t=>ScriptApp.deleteTrigger(t));
}

// ===================== Yurest =====================

function pbYurestListar_(desde, hasta){
  const todas = [];
  let pagina = 1;
  for(let vueltas=0; vueltas<30; vueltas++){
    const r = pbYurestGet_('/v2/delivery-notes?from_date=' + desde + '&to_date=' + hasta + '&per_page=100&page=' + pagina);
    const items = (r && r.data && r.data.items) || [];
    todas.push.apply(todas, items);
    const pag = r && r.data && r.data.pagination;
    if(!pag || !pag.last_page || pagina >= pag.last_page || items.length===0) break;
    pagina++;
  }
  return todas;
}

function pbYurestDetalle_(id){
  const r = pbYurestGet_('/v2/delivery-notes/' + id);
  return (r && r.data) || {};
}

// Líneas útiles del albarán: nombre, id de producto de Yurest, formato de
// compra y cantidad confirmada (si no hay confirmada, la pedida).
function pbYurestLineas_(det){
  return (det.lines || []).map(l=>{
    const prod = l.product || {};
    const scan = l.scan_item || {};
    let cantidad = Number(l.confirmed_quantity);
    if(!(cantidad > 0)) cantidad = Number(l.ordered_quantity) || 0;
    cantidad += Number(l.promo_quantity) || 0;      // unidades de regalo también entran
    return {
      lineaId: l.id,
      productoId: prod.id || null,
      nombre: String(prod.name || scan.name || l.reference || 'Sin nombre').trim(),
      formato: l.purchase_format || '',
      unidadesFormato: Number(l.format_unit_quantity) || null,
      cantidad: Math.round(cantidad * 1000) / 1000
    };
  }).filter(l=>l.cantidad > 0);
}

function pbYurestHuella_(lineas){
  const txt = lineas.map(l=>[l.productoId, l.nombre, l.cantidad].join('|')).sort().join('#');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, txt, Utilities.Charset.UTF_8);
  return bytes.map(b=>('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function pbYurestEsProveedor_(nombre){
  const props = PropertiesService.getScriptProperties();
  const lista = (props.getProperty('PB_YUREST_PROVEEDORES') || PBY.PROVEEDORES_DEFECTO)
    .split(',').map(pbYurestNorm_).filter(Boolean);
  const n = pbYurestNorm_(nombre);
  return !!n && lista.some(p=>n.indexOf(p) >= 0);
}

function pbYurestNorm_(s){
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
}

function pbYurestGet_(ruta){
  for(let intento=0; intento<2; intento++){
    const sesion = pbYurestSesion_(intento > 0);
    const res = UrlFetchApp.fetch(PBY.YUREST_URL + ruta, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + sesion,
        'X-Provider-Token': PropertiesService.getScriptProperties().getProperty('YUREST_TOKEN'),
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if(code === 401 && intento === 0) continue;       // sesión caducada: nuevo login
    if(code === 403) throw new Error('Yurest deniega el acceso a los albaranes (403). El usuario necesita el permiso «albaranes» y el token de integración el ámbito «delivery-notes».');
    if(code < 200 || code >= 300) throw new Error('Yurest respondió ' + code + ' en ' + ruta + ': ' + res.getContentText().slice(0,300));
    return JSON.parse(res.getContentText());
  }
}

function pbYurestSesion_(forzar){
  const props = PropertiesService.getScriptProperties();
  if(!forzar){
    const guardada = props.getProperty(PBY.PROP_SESION);
    if(guardada) return guardada;
  }
  const token = props.getProperty('YUREST_TOKEN');
  const email = props.getProperty('YUREST_EMAIL');
  const clave = props.getProperty('YUREST_CLAVE');
  if(!token || !email || !clave) throw new Error('Yurest todavía no está configurado (faltan YUREST_TOKEN, YUREST_EMAIL o YUREST_CLAVE).');
  const res = UrlFetchApp.fetch(PBY.YUREST_URL + '/v2/auth/login', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Provider-Token': token, 'Accept': 'application/json' },
    payload: JSON.stringify({ email: email, password: clave }),
    muteHttpExceptions: true
  });
  if(res.getResponseCode() !== 200) throw new Error('No se pudo entrar en Yurest (' + res.getResponseCode() + ').');
  const acceso = JSON.parse(res.getContentText()).data.access_token;
  props.setProperty(PBY.PROP_SESION, acceso);
  return acceso;
}

// ===================== Firestore (API REST) =====================

function pbYurestFsUrl_(idDoc){
  return 'https://firestore.googleapis.com/v1/projects/' + PBY.FIREBASE_PROYECTO +
    '/databases/(default)/documents/' + PBY.COLECCION + '/' + encodeURIComponent(idDoc);
}

function pbYurestFsLeer_(idDoc){
  const res = UrlFetchApp.fetch(pbYurestFsUrl_(idDoc) + '?key=' + PBY.FIREBASE_CLAVE_WEB, { muteHttpExceptions: true });
  if(res.getResponseCode() === 404) return null;
  if(res.getResponseCode() !== 200) throw new Error('Firestore (leer) respondió ' + res.getResponseCode() + ': ' + res.getContentText().slice(0,300));
  const f = JSON.parse(res.getContentText()).fields || {};
  const out = {};
  Object.keys(f).forEach(k=>{
    const v = f[k];
    out[k] = ('stringValue' in v) ? v.stringValue : ('booleanValue' in v) ? v.booleanValue :
             ('integerValue' in v) ? Number(v.integerValue) : null;
  });
  return out;
}

function pbYurestFsCampos_(obj){
  const fields = {};
  Object.keys(obj).forEach(k=>{
    const v = obj[k];
    if(typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if(typeof v === 'number') fields[k] = { integerValue: String(Math.round(v)) };
    else fields[k] = { stringValue: String(v) };
  });
  return fields;
}

function pbYurestFsCrear_(idDoc, obj){
  const url = pbYurestFsUrl_(idDoc) + '?key=' + PBY.FIREBASE_CLAVE_WEB + '&currentDocument.exists=false';
  const res = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json',
    payload: JSON.stringify({ fields: pbYurestFsCampos_(obj) }), muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if(code === 400 || code === 409 || code === 412) return; // ya existía (otra pasada lo creó)
  if(code !== 200) throw new Error('Firestore (crear) respondió ' + code + ': ' + res.getContentText().slice(0,300));
}

function pbYurestFsActualizar_(idDoc, obj){
  const mask = Object.keys(obj).map(k=>'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const url = pbYurestFsUrl_(idDoc) + '?key=' + PBY.FIREBASE_CLAVE_WEB + '&currentDocument.exists=true&' + mask;
  const res = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json',
    payload: JSON.stringify({ fields: pbYurestFsCampos_(obj) }), muteHttpExceptions: true
  });
  if(res.getResponseCode() !== 200) throw new Error('Firestore (actualizar) respondió ' + res.getResponseCode() + ': ' + res.getContentText().slice(0,300));
}

// ===================== Fechas (hora de Madrid) =====================

function pbYurestHoy_(){
  return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
}
function pbYurestSumarDias_(ymd, dias){
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1]-1, p[2] + dias, 12));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}
