# Subida automática a la Chrome Web Store (API)

Una sola vez, unos 10 minutos. Después, `npm run release:publish` compila, arma la carpeta de release, sube el zip y lo manda a revisión.

Importante: hazlo con la MISMA cuenta de Google que es dueña del item de Netio en el panel de desarrollador (la que ves en https://chrome.google.com/webstore/devconsole). La API solo acepta subir el zip al item si el token pertenece al publicador; con otra cuenta responde 403 o "NOT_FOUND" aunque el id sea correcto. Si el item está en un grupo de publicadores, la cuenta debe ser miembro.

1. Entra a https://console.cloud.google.com con esa cuenta y crea un proyecto (nombre libre, por ejemplo "netio-cws").
2. En el proyecto: APIs y servicios > Biblioteca > busca "Chrome Web Store API" > Habilitar.
3. APIs y servicios > Pantalla de consentimiento de OAuth: tipo Externo, nombre de la app "Netio release", tu correo como soporte y como contacto. Guarda. En "Usuarios de prueba" agrega tu propia cuenta (la del punto anterior). No hace falta publicar la app ni pasar verificación: con la app en "Prueba" y tu cuenta como usuario de prueba alcanza.
4. APIs y servicios > Credenciales > Crear credenciales > ID de cliente de OAuth > tipo "Aplicación de escritorio". Copia el ID de cliente y el secreto.
5. En la terminal, en la raíz del repo: `node scripts/cws-auth.mjs`. Pega el ID y el secreto cuando los pida, abre la URL que imprime en el navegador con la cuenta dueña del item, acepta. El script recibe el código en http://localhost:8085, lo cambia por un refresh token y escribe `.cws.env` (ignorado por git).
   Si el navegador no puede volver a localhost (otra máquina, puerto ocupado), corre `node scripts/cws-auth.mjs --oob` y pega el código a mano.
6. Listo. `npm run release:publish` sube `release/netio-<versión>/netio-<versión>.zip` y lo envía a revisión. En la salida verás `uploadState: SUCCESS` y luego `status: ["OK"]` o `["ITEM_PENDING_REVIEW"]`.

Notas

- Caducidad: mientras la app de consentimiento esté en estado "Prueba" (tipo Externo), Google caduca los refresh tokens a los 7 días. Para que dure, en la pantalla de consentimiento pulsa "Publicar la app": el scope de Chrome Web Store no exige verificación, solo muestra una advertencia de app no verificada que aceptas una vez al correr el paso 5. Si el token caduca, vuelve a correr el paso 5.
- La API sube el zip y envía a revisión. La ficha (descripción, capturas, mosaico) y la pestaña Privacidad siguen siendo manuales: ver `README.txt` dentro de la carpeta de release.
- Variables que lee `scripts/cws-publish.mjs`: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID` (por defecto `bjhikillfgbpblogloljjhejogfeajac`). El entorno gana sobre `.cws.env`, así que también sirve en CI como secretos.
