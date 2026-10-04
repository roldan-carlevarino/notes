# Notas

Frontend estático independiente del dashboard. La autenticación se realiza directamente contra el API compartido; no lee cookies, código ni almacenamiento del dashboard.

## Configuración

La URL predeterminada es `https://api-dashboard-production-fc05.up.railway.app`. Para cambiarla en un despliegue, edita `api-config.js` o define `window.NOTES_API_BASE_URL` antes de cargar ese archivo. Es una URL base sin `/api`; el cliente añade rutas como `/auth/login` y `/profiles/{profile}/notes`.

Sirve esta carpeta desde un origen HTTP(S) autorizado por CORS en el backend. Para iniciar sesión, la app envía `username` y `password` como `application/x-www-form-urlencoded`, conserva solo `access_token` en `notes_api_session_v1` y no guarda la contraseña. El login de esta web es propio y el token se comparte entre sus ventanas vía `localStorage` y `BroadcastChannel`. Cerrar sesión o recibir un `401` elimina ese token.

La cuenta `demo` puede listar, consultar y buscar, pero la interfaz bloquea crear, editar, borrar y migrar. No uses esa cuenta para migrar.

Si un PATCH falla, el editor conserva solo los campos pendientes en `notes_api_pending_v1::<sub-del-JWT>::<perfil>` y muestra **Reintentar**. La contraseña nunca se conserva. Un `401` limpia la sesión y los borradores quedan disponibles al iniciar sesión de nuevo con el mismo sujeto.

## Migración local

1. Inicia sesión con la cuenta normal que tenga permiso de escritura.
2. En cada perfil, usa **Migrar copia local**. La app manda un POST por cada nota local no registrada; el API genera IDs y timestamps nuevos.
3. La app guarda el ID remoto devuelto en un manifiesto `notes_api_migration_v1::<sub-del-JWT>` solo después de recibir la respuesta. Los manifiestos y borradores pendientes están aislados por sujeto autenticado. La copia `notes_app_v1::<perfil>` no se modifica ni se borra.
4. Tras el lote se consulta de nuevo la lista del perfil. **Verificar en servidor** permite repetir esta comprobación después. Solo las correspondencias cuyos IDs aparezcan en el GET se cuentan como verificadas.
5. Las notas históricas sin perfil se copian a `notes_app_v1::Keysight` y se verifican antes de considerar esa copia completa. La clave antigua `notes_app` se mantiene intacta como respaldo.

No se pueden conservar en servidor los IDs locales ni los valores históricos de `created`/`updated`: el CRUD normal asigna valores nuevos. El contenido, título y color se migran; ambas copias locales continúan intactas.

Un POST cuyo resultado de red sea incierto queda marcado como `uncertain` y no se vuelve a enviar automáticamente. En la sección de migración, **Revisar reintento** primero busca una nota remota con el mismo contenido. Si encuentra exactamente una, se puede vincular sin crear otra. Si no la encuentra o hay varias, la app pide confirmación explícita: podría crear un duplicado porque el backend no proporciona clave idempotente ni endpoint de importación. Revisa el perfil remoto antes de confirmar ese reintento. Los fallos de login, red y API no borran la copia local.

## Pruebas

Requiere Node.js 18 o posterior; no hay dependencias npm externas.

```sh
npm test
```
