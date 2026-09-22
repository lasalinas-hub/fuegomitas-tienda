/**
 * FUEGOMITAS · crear-pago
 * -----------------------------------------------------------------------------
 * Crea una preferencia de pago de Mercado Pago (Checkout Pro) y devuelve el link
 * al que hay que mandar al cliente.
 *
 * REGLA DE ORO: el navegador SOLO manda cantidades. Los precios, las promos y el
 * envío se calculan AQUÍ. Si confiáramos en el total que manda el navegador,
 * cualquiera podría abrir la consola y pagar $1 por el Pack 200.
 *
 * Variables de entorno (Netlify → Site settings → Environment variables):
 *   MP_ACCESS_TOKEN  → Tu Access Token de producción (APP_USR-...). SECRETO.
 *   SITE_URL         → https://fuegomitas.mx   (sin diagonal al final)
 * -----------------------------------------------------------------------------
 */

const { MercadoPagoConfig, Preference } = require('mercadopago');

/* ============================ CATÁLOGO (fuente de verdad) ==================== */

const PRECIO = 25;                 // MXN por bolsa de 80g, IEPS incluido

const PRODUCTOS = {
  durazno: { titulo: 'Aros de durazno enchilados 80g' },
  pandi:   { titulo: 'Pandibañadas 80g' },
  sandia:  { titulo: 'Rebañadas de sandía 80g' },
  lombri:  { titulo: 'Lombribañadas 80g' },
};

// Bolsas de regalo por volumen. Mismos números que la página.
const NIVELES = [
  { min: 200, regalo: 40 },
  { min: 100, regalo: 15 },
  { min: 50,  regalo: 5  },
];

const ENVIO_GRATIS_DESDE = 899;    // MXN
const COSTO_ENVIO        = 100;    // MXN

/**
 * Ticket mínimo para pagar con tarjeta en línea.
 * Mercado Pago cobra 3.49% + $4 + IVA. En un pedido de $25 esa comisión fija se
 * come el 22% del ticket. Abajo de este monto conviene cobrar por transferencia
 * o efectivo vía WhatsApp. Súbelo o bájalo según tu margen.
 */
const MINIMO_EN_LINEA = 200;

const MAX_BOLSAS = 5000;           // tope de cordura contra pedidos basura

/* ============================== CÁLCULO ==================================== */

function regaloPara(cantidad) {
  for (const n of NIVELES) if (cantidad >= n.min) return n.regalo;
  return 0;
}

/**
 * Recibe { durazno: 10, sandia: 5, ... } y devuelve el desglose autoritativo.
 * Ignora cualquier llave que no exista en PRODUCTOS.
 */
function calcular(carritoCrudo) {
  const carrito = {};
  let bolsas = 0;

  for (const id of Object.keys(PRODUCTOS)) {
    const n = Math.floor(Number(carritoCrudo[id]));
    if (Number.isFinite(n) && n > 0) {
      carrito[id] = n;
      bolsas += n;
    }
  }

  if (bolsas === 0)          throw new Error('CARRITO_VACIO');
  if (bolsas > MAX_BOLSAS)   throw new Error('CARRITO_EXCEDIDO');

  const regalo    = regaloPara(bolsas);
  const subtotal  = bolsas * PRECIO;                 // lo que realmente paga
  const lista     = (bolsas + regalo) * PRECIO;      // precio de lista de lo que se lleva
  const descuento = lista - subtotal;
  // Envío gratis si llega al monto mínimo O si alcanzó cualquier nivel de promo.
  const envio     = (subtotal >= ENVIO_GRATIS_DESDE || regalo > 0) ? 0 : COSTO_ENVIO;

  return {
    carrito, bolsas, regalo,
    totalBolsas: bolsas + regalo,
    lista, descuento,
    pct: lista > 0 ? Math.round((descuento / lista) * 100) : 0,
    subtotal, envio,
    total: subtotal + envio,
  };
}

function folio() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `FG-${ymd}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/* ============================== HANDLER ==================================== */

exports.handler = async (event) => {
  const json = (statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

  if (event.httpMethod !== 'POST') return json(405, { error: 'Usa POST' });

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

  if (!ACCESS_TOKEN) return json(500, { error: 'Falta la variable MP_ACCESS_TOKEN en Netlify.' });
  if (!SITE_URL)     return json(500, { error: 'Falta la variable SITE_URL en Netlify.' });

  let cuenta;
  try {
    const entrada = JSON.parse(event.body || '{}');
    cuenta = calcular(entrada.items || {});
  } catch (e) {
    const msg = {
      CARRITO_VACIO:     'Tu carrito está vacío.',
      CARRITO_EXCEDIDO:  'Ese pedido es enorme — escríbenos por WhatsApp y lo cotizamos.',
    }[e.message] || 'No pudimos leer tu pedido.';
    return json(400, { error: msg });
  }

  if (cuenta.total < MINIMO_EN_LINEA) {
    return json(400, {
      error: `El pago en línea aplica desde $${MINIMO_EN_LINEA}. Para pedidos más chicos ` +
             `termina por WhatsApp: te pasamos datos de transferencia o pagas en efectivo.`,
      minimo: MINIMO_EN_LINEA,
    });
  }

  const referencia = folio();

  // Un renglón por sabor, al precio real. La suma de los items ES lo que se cobra.
  const items = Object.entries(cuenta.carrito).map(([id, qty]) => ({
    id,
    title: PRODUCTOS[id].titulo,
    quantity: qty,
    unit_price: PRECIO,
    currency_id: 'MXN',
    category_id: 'food',
  }));

  const notaRegalo = cuenta.regalo > 0
    ? `Incluye ${cuenta.regalo} bolsas de regalo por promo de volumen. Te llevas ${cuenta.totalBolsas} bolsas en total.`
    : '';

  const cliente = new MercadoPagoConfig({
    accessToken: ACCESS_TOKEN,
    options: { timeout: 8000 },
  });

  try {
    const preferencia = await new Preference(cliente).create({
      body: {
        items,
        external_reference: referencia,
        statement_descriptor: 'FUEGOMITAS',
        additional_info: notaRegalo,
        shipments: { cost: cuenta.envio, mode: 'not_specified' },
        back_urls: {
          success: `${SITE_URL}/gracias.html`,
          pending: `${SITE_URL}/pago-pendiente.html`,
          failure: `${SITE_URL}/pago-fallido.html`,
        },
        auto_return: 'approved',
        notification_url: `${SITE_URL}/.netlify/functions/webhook-mp`,
        payment_methods: {
          // Mensualidades CON intereses (las paga el cliente, a ti no te cuestan).
          // Si algún día quieres MSI, se activan en el panel de MP y el costo
          // extra corre por tu cuenta: 3 meses 4.69%, 6 meses 7.69%, 12 meses 12.89%.
          installments: 12,
        },
        metadata: {
          folio: referencia,
          bolsas_pagadas: cuenta.bolsas,
          bolsas_regalo: cuenta.regalo,
          bolsas_totales: cuenta.totalBolsas,
          descuento: cuenta.descuento,
          envio: cuenta.envio,
          total: cuenta.total,
          detalle: cuenta.carrito,
        },
      },
      requestOptions: { idempotencyKey: referencia },
    });

    return json(200, {
      init_point: preferencia.init_point,
      folio: referencia,
      resumen: {
        bolsas: cuenta.bolsas,
        regalo: cuenta.regalo,
        totalBolsas: cuenta.totalBolsas,
        lista: cuenta.lista,
        descuento: cuenta.descuento,
        pct: cuenta.pct,
        subtotal: cuenta.subtotal,
        envio: cuenta.envio,
        total: cuenta.total,
      },
    });
  } catch (err) {
    console.error('[crear-pago] Error de Mercado Pago:', err && (err.message || err));
    return json(502, { error: 'No pudimos abrir el pago. Intenta de nuevo o termina por WhatsApp.' });
  }
};

// Se exporta solo para poder probar el cálculo sin llamar a Mercado Pago.
exports._calcular = calcular;
