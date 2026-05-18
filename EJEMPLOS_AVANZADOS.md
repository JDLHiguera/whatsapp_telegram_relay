# Ejemplos avanzados

Estos ejemplos están pensados para el relay actual: WhatsApp secundario -> bot externo de Telegram -> mismo chat de WhatsApp.

## 1. Cambiar el chat relay

Para reiniciar el chat único permitido:

```bash
rm -f data/relay_state.json
npm run dev
```

El primer mensaje que llegue desde WhatsApp vuelve a fijar el chat relay.

## 2. Forzar una nueva sesión de Telegram

Si quieres volver a autenticarte con tu cuenta de Telegram:

```bash
rm -f data/telegram.session
npm run dev
```

La próxima ejecución pedirá login otra vez y guardará una nueva sesión.

## 3. Mantener el bot externo abierto

En Telegram, el puente solo reenvía texto al bot externo configurado en `TELEGRAM_RELAY_BOT_USERNAME`.

Si quieres extenderlo para imágenes, audios o documentos, el punto a tocar es `src/services/bridge.ts`.

## 4. Añadir más reglas de filtrado

Puedes bloquear mensajes antes de enviarlos al bot externo en `src/services/bridge.ts`:

```ts
if (messageText.length > 1000) {
  continue
}
```

## 5. Guardar métricas extras

`src/database/sqlite.ts` ya registra logs de mensajes. Si quieres más trazas, añade columnas o una tabla adicional de auditoría.
