# Fuegomitas · cómo conectar los pagos en línea

Todo el código ya está listo. Lo único que falta son **cuatro datos** que solo tú
puedes sacar de tu cuenta de Mercado Pago. Calcula 45 minutos.

---

## Qué hay en esta carpeta

```
index.html                        La tienda (ya trae el botón de pago)
gracias.html                      Pago aprobado
pago-pendiente.html               Pago en OXXO / SPEI esperando confirmación
pago-fallido.html                 Pago rechazado
netlify.toml                      Configuración de Netlify
package.json                      Dependencias
netlify/functions/crear-pago.js   Crea el cobro (aquí viven los precios reales)
netlify/functions/webhook-mp.js   Recibe el aviso de pago de Mercado Pago
```

---

## Paso 1 · Da de alta ROTAS MX en Mercado Pago

En **mercadopago.com.mx** crea la cuenta como **persona moral** con el RFC y la
cuenta bancaria de ROTAS MX. Ten a la mano: acta constitutiva, poder del
representante legal, INE, constancia de situación fiscal, comprobante de
domicilio y la CLABE a nombre de la empresa.

> La CLABE **tiene que estar a nombre de ROTAS MX**. Si la pones a tu nombre
> personal, el dinero de la empresa cae en tu declaración y luego hay que
> desenredarlo con el contador.

## Paso 2 · Crea la aplicación y saca el Access Token

1. Entra a **Tus Integraciones** → *Crear aplicación*.
2. Nombre: `Fuegomitas Tienda`. Producto: **Checkout Pro**.
3. En *Credenciales de producción* copia el **Access Token** (empieza con `APP_USR-`).

⚠️ **El Access Token es como la llave de tu caja fuerte.** Nunca lo pegues en el
HTML, ni en un chat, ni en WhatsApp. Solo va en el panel de Netlify (paso 4).
Si alguna vez se te escapa, revócalo desde ese mismo panel y genera otro.

## Paso 3 · Configura el webhook

En la misma aplicación → **Webhooks / Notificaciones**:

- URL: `https://fuegomitas.mx/.netlify/functions/webhook-mp`
- Evento: **Pagos** (`payment`)
- Copia la **Clave secreta** que te genera.

El webhook es lo que te avisa de verdad que te pagaron. La página de gracias solo
significa que el cliente regresó al sitio — un pago en OXXO se aprueba horas
después y ese cliente nunca vuelve a la página.

## Paso 4 · Carga las variables en Netlify

**Site settings → Environment variables → Add a variable:**

| Variable | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | El Access Token del paso 2 |
| `MP_WEBHOOK_SECRET` | La clave secreta del paso 3 |
| `SITE_URL` | `https://fuegomitas.mx` (sin diagonal al final) |
| `NOTIFY_URL` | *(opcional)* webhook de Make o Zapier para que te llegue el pedido |

## Paso 5 · Sube el sitio

**Esto ya no se puede hacer arrastrando la carpeta.** Las funciones necesitan que
Netlify corra `npm install`, y el arrastre no ejecuta build. Dos caminos:

**Opción A — Git (recomendada).** Sube la carpeta a un repo de GitHub y conéctalo
en Netlify (*Add new site → Import an existing project*). A partir de ahí cada
cambio que subas se publica solo.

**Opción B — Netlify CLI.** Desde la terminal, dentro de esta carpeta:

```bash
npm install -g netlify-cli
netlify login
netlify link          # conecta con tu sitio existente
netlify deploy --prod
```

## Paso 6 · Prueba antes de cobrarle a alguien de verdad

1. En Netlify cambia `MP_ACCESS_TOKEN` por el de **prueba** (`TEST-...`).
2. Haz un pedido en tu sitio y paga con estas tarjetas de prueba:

| Tarjeta | Número | CVV | Vence |
|---|---|---|---|
| Visa crédito | 4075 5957 1648 3764 | 123 | 11/30 |
| Mastercard crédito | 5474 9254 3267 0366 | 123 | 11/30 |
| Amex crédito | 3711 803032 57522 | 1234 | 11/30 |

En **nombre del titular** escribe el código del resultado que quieras simular:
`APRO` (aprobado), `FUND` (sin fondos), `SECU` (CVV inválido), `OTHE` (rechazo
general). Así pruebas las tres páginas de resultado sin mover dinero real.

3. Revisa que el pedido aparezca en **Netlify → Functions → webhook-mp → Logs**.
4. Cuando todo pase, regresa el token de producción.

---

## Lo que ya quedó blindado

- **Los precios se calculan en el servidor, nunca en el navegador.** El navegador
  solo manda cantidades. Si alguien abre la consola y modifica el total, no pasa
  nada: `crear-pago.js` recalcula todo desde cero. Sin esto, cualquiera podría
  pagar $1 por el Pack 200.
- **El webhook verifica la firma de cada aviso** y rechaza avisos falsos o
  repetidos (ventana de 5 minutos). Probado contra firma alterada, sin firma, con
  ID manipulado y con replay viejo: los cuatro casos se rechazan.
- **El monto real se consulta contra la API de Mercado Pago**, nunca se confía en
  lo que venga en el aviso.
- **Tope de 5,000 bolsas por pedido** para que nadie te meta basura.

## Decisión que puedes cambiar en un renglón

`MINIMO_EN_LINEA = 200` (está en `crear-pago.js` y en `index.html`).

Abajo de $200 el botón de tarjeta no aparece y el pedido se cierra por WhatsApp.
La razón: Mercado Pago cobra **3.49% + $4 + IVA**, y esa comisión fija se come el
**22% de un pedido de $25**. Apenas a los ~$500 baja del 5%.

| Ticket | Comisión (con IVA) | % del ticket |
|---|---|---|
| $25 | $6 | 22.6% |
| $125 | $10 | 7.8% |
| $425 | $22 | 5.2% |
| $1,250 (Pack 50) | $55 | 4.4% |
| $2,500 (Pack 100) | $106 | 4.2% |

Si prefieres aceptar tarjeta en cualquier monto, cambia el número a `0` en los
dos archivos.

## Meses sin intereses

Está configurado en **mensualidades con intereses**: el cliente puede diferir
hasta 12 meses y los intereses los paga él, a ti no te cuestan nada.

Si algún día quieres ofrecer **meses SIN intereses**, se activan en el panel de
Mercado Pago y el costo lo absorbes tú: 3 meses 4.69%, 6 meses 7.69%, 12 meses
12.89% — encima del 3.49% base. En un Pack 100 a 6 MSI estarías regalando ~$192
adicionales sobre un descuento que ya es del 13%. Yo lo dejaría apagado hasta
tener el margen medido.

## Plazo de depósito

Por default cobras con **depósito inmediato a 3.49% + $4**. En el panel de
Mercado Pago puedes cambiarlo a **30 días y bajar a 2.95%** — son ~0.63 puntos
de ahorro, pero el dinero tarda un mes en caer. Con inventario que financiar, esa
decisión es de flujo, no de costo.
