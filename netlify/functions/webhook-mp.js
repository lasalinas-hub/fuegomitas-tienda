/**
 * FUEGOMITAS · webhook-mp
 * -----------------------------------------------------------------------------
 * Mercado Pago avisa aquí cada vez que cambia el estado de un pago.
 * Es la ÚNICA fuente confiable de "ya me pagaron": la página de gracias solo
 * significa que el cliente regresó al sitio, no que el dinero entró. Un pago en
 * OXXO, por ejemplo, se aprueba horas después y el cliente nunca vuelve a la web.
 *
 * Qué hace:
 *   1. Verifica la firma (que el aviso venga de verdad de Mercado Pago).
 *   2. Consulta el pago real contra la API — nunca confía en el cuerpo del aviso.
 *   3. Deja el pedido en el log y, si configuras NOTIFY_URL, lo reenvía ahí.
 *
 * Variables de entorno:
 *   MP_ACCESS_TOKEN     → el mismo de crear-pago. SECRETO.
 *   MP_WEBHOOK_SECRET   → "Clave secreta" de tu webhook en Tus Integraciones.
 *   NOTIFY_URL          → (opcional) webhook de Make/Zapier para avisarte a
 *                          WhatsApp o correo cuando entre un pago aprobado.
 * -----------------------------------------------------------------------------
 */

const {
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError,
} = require('mercadopago');

exports.handler = async (event) => {
  // MP reintenta si no le devolvemos 2xx. Fuera de la firma inválida, casi
  // siempre contestamos 200 para no quedar en un bucle de reintentos.
  const ok = (msg) => ({ statusCode: 200, body: msg || 'ok' });

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Usa POST' };

  const ACCESS_TOKEN   = process.env.MP_ACCESS_TOKEN;
  const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
  const NOTIFY_URL     = process.env.NOTIFY_URL;

  if (!ACCESS_TOKEN || !WEBHOOK_SECRET) {
    console.error('[webhook] Faltan MP_ACCESS_TOKEN o MP_WEBHOOK_SECRET.');
    return ok('config pendiente');
  }

  const headers = event.headers || {};
  const query   = event.queryStringParameters || {};

  let aviso = {};
  try { aviso = JSON.parse(event.body || '{}'); } catch (_) {}

  // data.id puede venir en el query o en el cuerpo, según el tipo de aviso.
  const dataId = query['data.id'] || query.id || (aviso.data && aviso.data.id) || aviso.id;

  /* ---------- 1. Verificar la firma ---------- */
  try {
    WebhookSignatureValidator.validate({
      xSignature: headers['x-signature'],
      xRequestId: headers['x-request-id'],
      dataId: dataId,
      secret: WEBHOOK_SECRET,
      toleranceSeconds: 300,   // ventana de 5 min contra ataques de repetición
    });
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) {
      console.warn('[webhook] Firma inválida:', err.reason, '· request:', err.requestId);
      return { statusCode: 401, body: 'firma inválida' };
    }
    console.error('[webhook] Error validando firma:', err && err.message);
    return { statusCode: 401, body: 'firma inválida' };
  }

  /* ---------- 2. Solo nos interesan los avisos de pago ---------- */
  const tipo = aviso.type || aviso.topic || query.type || query.topic;
  if (tipo !== 'payment') return ok('aviso ignorado: ' + tipo);
  if (!dataId)            return ok('aviso sin id');

  /* ---------- 3. Consultar el pago REAL ---------- */
  const cliente = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN, options: { timeout: 8000 } });

  let pago;
  try {
    pago = await new Payment(cliente).get({ id: String(dataId) });
  } catch (err) {
    console.error('[webhook] No se pudo consultar el pago', dataId, err && err.message);
    return { statusCode: 500, body: 'reintenta' };   // aquí SÍ queremos reintento
  }

  const meta = pago.metadata || {};
  const pedido = {
    folio:        pago.external_reference || meta.folio || null,
    pago_id:      pago.id,
    estado:       pago.status,                 // approved | pending | rejected | refunded...
    detalle:      pago.status_detail,
    metodo:       pago.payment_type_id,        // credit_card | debit_card | ticket (OXXO) | bank_transfer (SPEI)
    total:        pago.transaction_amount,
    neto:         pago.transaction_details && pago.transaction_details.net_received_amount,
    comision:     Array.isArray(pago.fee_details)
                    ? pago.fee_details.reduce((a, f) => a + (f.amount || 0), 0)
                    : null,
    email:        pago.payer && pago.payer.email,
    bolsas:       meta.bolsas_totales,
    regalo:       meta.bolsas_regalo,
    envio:        meta.envio,
    articulos:    meta.detalle,
    fecha:        pago.date_approved || pago.date_created,
  };

  // Queda en Netlify → Functions → webhook-mp → Logs
  console.log('[webhook] PEDIDO', JSON.stringify(pedido));

  /* ---------- 4. Avisarte a ti (opcional) ---------- */
  if (NOTIFY_URL && pago.status === 'approved') {
    try {
      await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pedido),
      });
    } catch (err) {
      console.error('[webhook] No se pudo avisar a NOTIFY_URL:', err && err.message);
    }
  }

  return ok();
};
