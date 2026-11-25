<h1 align="center">
  <img src="../../public/icon.svg" alt="Codeg logo" width="56" align="absmiddle" /> Codeg, versión personalizada
</h1>

<p align="center">
  <a href="https://github.com/keh4l/codeg/releases/latest"><img src="https://img.shields.io/github/v/release/keh4l/codeg?style=flat&color=e91e63" alt="Última versión" /></a>
  <a href="https://github.com/spacering-net/codeg"><img src="https://img.shields.io/badge/upstream-spacering--net%2Fcodeg-24292f?style=flat" alt="Proyecto original" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/keh4l/codeg?style=flat" alt="Licencia" /></a>
</p>

<p align="center">
  <sub><a href="../../README.md">简体中文</a> · <a href="./README.en.md">English</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <strong>Español</strong> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.pt.md">Português</a> · <a href="./README.ar.md">العربية</a></sub>
</p>

<p align="center">
  <strong><a href="https://github.com/spacering-net/codeg">Codeg</a>, el espacio de trabajo multiagente de xintaofei, personalizado por keh4l</strong><br/>
  Todos tus agentes de programación con IA en un solo lugar, trabajando juntos. Sigue de cerca al proyecto original y añade algunas funciones.
</p>

<h3 align="center"><a href="https://github.com/keh4l/codeg/releases/latest"><ins>Descargar</ins></a> · <a href="#instalación"><ins>Instalación</ins></a> · <a href="https://docs.codeg.app"><ins>Documentación oficial</ins></a></h3>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/workspace-dark.png" />
    <img src="../images/workspace-light.png" alt="El espacio de trabajo de Codeg: una conversación con un agente junto a sus diffs en vivo y los archivos del proyecto" width="960" />
  </picture>
</p>

## Diferencias con la versión oficial

<table>
  <tr>
    <td width="50%" valign="top">🪟 <strong>Pestañas por ventana</strong><br/>Con varias ventanas sobre un mismo servidor, desactiva la sincronización de pestañas y cada ventana conserva las suyas; conversaciones y mensajes se siguen sincronizando.</td>
    <td width="50%" valign="top">🌐 <strong>Respuestas y mensajes traducidos</strong><br/>Cada parte de la respuesta del agente se traduce a tu idioma en cuanto termina, también el razonamiento, las tarjetas de pregunta y las listas de tareas, y un mensaje pasa al inglés con una tecla, con modelos de traducción de Alibaba Cloud o Tencent Cloud, en un segundo por cada 1.000 caracteres.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🧩 <strong>Sesiones de los subagentes de Claude Code</strong><br/>Las filas de subagente tienen «Ver conversación», que abre su conversación completa como ya pasa con Codex; un subagente se puede ver mientras trabaja.</td>
    <td width="50%" valign="top">📱 <strong>Cambiar entre conversaciones abiertas en el móvil</strong><br/>En el móvil, toca el título de la conversación para ver todas las conversaciones abiertas y cómo va cada una, y toca una para cambiar a ella; el título avisa cuando otra te está esperando.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🎨 <strong>Los agentes generan imágenes</strong><br/>Configura la dirección, la clave y los modelos de OpenAI, Grok, Gemini o un intermediario, y cualquier agente compatible con MCP puede crear y editar imágenes y guardarlas donde indique; la imagen aparece en la conversación y la clave nunca pasa por el agente.</td>
    <td width="50%" valign="top">⏳ <strong>Resultados para agentes con tiempos de espera cortos</strong><br/>Algunos agentes esperan solo de 30 a 60 segundos por una llamada a una herramienta. Esta versión limita cada espera según el agente, responde a tiempo y recoge el resto en la siguiente llamada, así que una respuesta lenta a una pregunta ya no cuenta como sin respuesta.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🗂️ <strong>Solo los agentes que usas</strong><br/>Ajustes muestra solo los agentes que añadiste; el resto queda en «Añadir agentes», con búsqueda y para añadir varios a la vez. Una instalación nueva activa solo los que están instalados aquí, así que el selector de nueva conversación queda corto.</td>
    <td width="50%" valign="top">📋 <strong>Mantener pulsado para seleccionar texto en el móvil</strong><br/>Mantener pulsado el texto de una respuesta o del cuadro de mensaje muestra los tiradores de selección y el menú de copiar del propio móvil, en lugar del menú de la conversación; al seleccionar una respuesta con el dedo, Copiar texto / Citar / Preguntar aparecen bajo el cuadro de mensaje, lejos del menú del móvil.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🔁 <strong>Reiniciar el servidor desde la web</strong><br/>Ajustes → Sistema incorpora «Reiniciar codeg»: codeg desplegado en un servidor se reinicia sin entrar al servidor y la página se reconecta sola; restaurar una copia de seguridad en un servidor ahora también reinicia para aplicarla.</td>
    <td width="50%" valign="top">⏯️ <strong>Los subagentes siguen donde un error los paró</strong><br/>Cuando un subagente delegado se detiene porque se cayó la red, se agotó su cuota, caducó su inicio de sesión o el proveedor devolvió un error, el agente principal puede hacer que continúe en su sesión original, con el contexto y el trabajo a medias intactos, en lugar de empezar de cero en una nueva.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🧑‍💼 <strong>Los agentes te preparan asistentes @</strong><br/>Di «añade un asistente revisor con Codex y razonamiento alto» en una conversación y el agente crea o cambia el asistente @: nombre, agente, modelo e instrucciones permanentes como lo dijiste, y cada opción que no mencionaste con el valor por defecto del agente. Pulsa Editar en la propia conversación para ajustarlo.</td>
    <td width="50%" valign="top">🧭 <strong>Ajustes agrupados</strong><br/>La navegación de Ajustes se agrupa bajo cinco títulos; las páginas con muchas opciones reúnen las relacionadas en una sola tarjeta, todas las páginas tienen título y en el móvil un desplegable ya no aplasta su descripción.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">↩️ <strong>Los subagentes despiertan al agente principal al terminar</strong><br/>Cuando un subagente delegado termina, su resultado vuelve solo al agente principal: si está libre, empieza un turno nuevo y sigue; si está ocupado, lo recibe en el turno en curso; y si justo estás enviando un mensaje, va con él. El agente principal puede cerrar su turno nada más repartir el trabajo, sin quedarse esperando para consultar los resultados.</td>
    <td width="50%" valign="top">🌿 <strong>Los subagentes trabajan en su propio worktree</strong><br/>El agente principal puede hacer que un subagente cambie código en un worktree y una rama de git aparte, así que varios en paralelo no se estorban; cada delegación puede indicar su propio modelo y nivel de razonamiento, y a un subagente que ya terminó se le puede encargar más trabajo en la misma sesión.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🗣️ <strong>Intervenir en cualquier momento</strong><br/>Mientras el agente responde, la tecla de envío mete tu mensaje en el turno en curso y el agente lo lee tras el paso actual; con ⌘/Ctrl lo pones en cola para después. Se puede intervenir en cualquier agente. La cola vive en el servidor, así que sobrevive a una recarga y te sigue a otro dispositivo; al detener o si hay un error, la cola se pausa hasta que digas continuar.</td>
    <td width="50%" valign="top">✨ <strong>Vista compacta estilo T3</strong><br/>Pliega el trabajo de cada respuesta en una sola línea «Trabajó Xs» y muestra solo el paso activo al ejecutarse; cambia las tarjetas por un árbol de archivos modificados y revela el pie al pasar el cursor. Incluye cuatro niveles de herramientas, minimapa lateral, búsqueda ⌘/Ctrl+F en todo el hilo, citas con salto al origen, ajuste de línea y «Ejecutar en terminal» en código, y tema negro puro «Carbón». Revertible en Ajustes.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">🛰️ <strong>Acceso remoto más ágil</strong><br/>Con la versión web por una IP pública: tras recargar se puede escribir en un segundo o así, el último turno de una conversación larga se ve en menos de un segundo y volver a una conversación que acabas de ver ya no se queda en «Conectando». Si la red falla un momento, lo que faltó llega solo, sin aviso de reconexión ni texto perdido.</td>
    <td width="50%" valign="top">⚡ <strong>Los botones responden al momento y las respuestas salen a ritmo constante</strong><br/>Aprobar permisos, renombrar, eliminar, detener e intervenir surten efecto en cuanto pulsas. Una petición que no llegó se reintenta sola y nunca se ejecuta dos veces; solo un fallo real deshace el cambio, con un aviso. Con la red lenta, la respuesta ya no salta a ráfagas: el texto sale a ritmo constante.</td>
  </tr>
  <tr>
    <td colspan="2" valign="top">🏃 <strong>Se ve en marcha cuando el agente sigue por su cuenta</strong><br/>Cuando termina un comando o un subagente en segundo plano, Claude Code sigue trabajando por su cuenta, y Codex también puede empezar su siguiente turno solo. Ahora la conversación aparece en marcha mientras tanto, con botón de detener, y solo pasa a revisión y avisa cuando termina; lo que hace Codex en ese turno se muestra en directo, sin tener que pulsar «Cargar actividad en segundo plano».</td>
  </tr>
  <tr>
    <td colspan="2" valign="top">🔄 <strong>Al día con el original</strong><br/>Los cambios del proyecto original se incorporan con regularidad; lo que no aparece aquí funciona igual que en la versión oficial. Kiro CLI integrado, lo primero que añadió esta versión, forma parte de la versión oficial desde la 0.36.0. Los resúmenes del razonamiento de Claude Code usan desde la 0.41.3-1 el interruptor de la versión oficial: «Mostrar resúmenes del razonamiento de Claude» en Ajustes → Agentes → Claude Code, desactivado por defecto. Desde la 0.46.0-1, el siguiente mensaje sugerido se rellena como en la versión oficial: con Tab en el ordenador y con el botón de la bombilla junto a Enviar en el móvil.</td>
  </tr>
</table>

<details>
<summary><strong>Pestañas por ventana</strong>: detalles</summary>
<br/>

- Es el interruptor «Sincronizar pestañas de conversación entre ventanas» en Ajustes → General, activado por defecto: todas las ventanas y dispositivos del servidor (ordenador, tableta, móvil) comparten un único conjunto de pestañas abiertas, como en la versión oficial.
- Desactivado, abrir, enfocar o cerrar una pestaña de conversación en una ventana deja las demás como estaban, y al recargar vuelven las pestañas de esa ventana.
- Las conversaciones, los mensajes y las eliminaciones llegan siempre a todas las ventanas, sea cual sea el ajuste.
- El ajuste se guarda en el servidor: al cambiarlo en cualquier ventana o dispositivo, cambian con él todas las ventanas y dispositivos conectados a ese servidor. (Hasta la 0.35.2-1 se guardaba por navegador y venía desactivado en los navegadores.)
- Solicitado al proyecto original en [spacering-net/codeg#547](https://github.com/spacering-net/codeg/issues/547).

</details>

<details>
<summary><strong>Respuestas y mensajes traducidos</strong>: detalles</summary>
<br/>

- Se activa en Ajustes → Traducción con una clave de API de [Alibaba Cloud Bailian](https://bailian.console.aliyun.com/) o [Tencent Cloud TokenHub](https://console.cloud.tencent.com/tokenhub/apikey); cada plataforma cobra su propio uso. Por defecto usa `qwen-mt-flash` de Bailian, que tardó unos 0,5 s por párrafo en las pruebas.
- Respuestas: con el interruptor "Traducción de respuestas" activado, cada parte de una respuesta se traduce en cuanto el agente la termina (al pasar a una herramienta o a pensar, o al acabar el turno), entera en una sola solicitud para que el modelo la vea completa, y se muestra en lugar del original; mientras el agente escribe ves el original. El botón de traducir bajo cada respuesta vuelve al original o, si la traducción automática está desactivada, traduce solo esa respuesta. El razonamiento se traduce al desplegarlo (la línea de título que se ve aun plegado queda en el original) y sigue el mismo botón; no se traducen bloques de código ni llamadas a herramientas. El botón de copiar copia lo que se ve en pantalla.
- Nombres de sesión: con la traducción automática de respuestas activada, los nombres que el agente da a las sesiones también se muestran en tu idioma, en la barra lateral, las pestañas y la cabecera de la conversación. Un nombre que pusiste tú se queda como lo escribiste, y al pasar el puntero sobre una sesión de la barra lateral se ve el original.
- Tarjetas de pregunta: cuando un agente te pregunta algo, la pregunta y sus opciones se muestran traducidas por defecto (se desactiva en Ajustes → Traducción), y el botón de arriba a la derecha de la tarjeta alterna entre original y traducción; la respuesta sigue nombrando la opción del agente. Una respuesta escrita en "Otro" se traduce al idioma de destino con el botón de al lado o `⌘⇧L`, y el mismo botón la devuelve; con "Traducir al enviar" activado se traduce al enviarla. Las preguntas marcadas como secretas nunca se envían a traducir.
- Listas de tareas: los pasos de la lista de tareas del agente (la fila «Actualizó el plan» en una respuesta, el plan flotante sobre la conversación y el plan en Detalles de la sesión) se muestran traducidos por defecto, toda la lista en una sola petición (se desactiva con "Traducir listas de tareas automáticamente" en Ajustes → Traducción). El botón que aparece bajo la lista al desplegar esa fila (en el plan flotante, en su barra de título) alterna entre original y traducción; con la opción desactivada, el mismo botón traduce a mano.
- Mensajes: el botón de traducir del cuadro de mensaje, `⌘⇧L` (`Ctrl+Shift+L` en Windows y Linux) o el menú contextual traducen el cuadro en su sitio al idioma de destino (inglés por defecto). Menciones, comandos de barra, rutas y código se quedan igual, y `⌘Z` recupera el original de una vez. Solo se traduce cuando lo pides, así que un borrador a medias nunca sale del equipo. "Traducir al enviar" lo hace en cada envío. Ya enviado, el botón de traducir junto al mensaje vuelve a lo que escribiste antes de traducir, y copiar sigue lo que se muestra.
- Ante un límite de solicitudes pasa a `qwen-mt-lite` o al otro motor; un glosario fija cómo se traducen términos concretos, y una entrada sin traducción mantiene el término tal cual.
- Las claves de API se guardan en el llavero del sistema (en un servidor, en `tokens.json` dentro del directorio de datos), nunca en la base de datos; el botón del ojo en Ajustes muestra una clave guardada. Las solicitudes de traducción se conectan directamente, sin proxy, y solo usan el proxy cuando la red no permite otra salida.
- La traducción de las respuestas es solo para mostrarla: el historial de la conversación conserva el texto original del agente. Lo que escribiste antes de traducir un mensaje se guarda en la base de datos local, y vaciar la caché de traducción no lo borra.

</details>

<details>
<summary><strong>Sesiones de los subagentes de Claude Code</strong>: detalles</summary>
<br/>

- Claude Code guarda la conversación entera de cada subagente (herramienta Agent / Task) en un archivo propio, `~/.claude/projects/<proyecto>/<id de sesión>/subagents/agent-<id>.jsonl`. En la versión oficial la fila del subagente solo muestra un resumen de su proceso y el resultado final (la de un subagente en segundo plano, ni el resumen), y ese archivo no se puede abrir.
- Esta versión añade a la fila del subagente el enlace «Ver conversación ↗», que abre ese registro en un panel lateral: la tarea que recibió, su razonamiento y sus respuestas, y cada llamada a herramienta con su entrada y su salida. Es el mismo enlace que tienen las filas de subagente de Codex y Grok.
- El enlace aparece en cuanto arranca el subagente, en primer o en segundo plano. Si lo abres mientras sigue trabajando, el panel se actualiza cada 2 segundos y muestra como «En ejecución» la llamada a herramienta que se está ejecutando. Abierto después de recargar la conversación, muestra el registro tal como estaba entonces; ciérralo y vuelve a abrirlo para ver lo último.
- También funciona en conversaciones anteriores, mientras el archivo del subagente siga ahí.

</details>

<details>
<summary><strong>Cambiar entre conversaciones abiertas en el móvil</strong>: detalles</summary>
<br/>

- Con menos de 768 px de ancho (un móvil o una ventana del navegador muy estrecha), la versión oficial no muestra la barra de pestañas de conversación. Para llegar a otra conversación abierta hay que buscarla en el historial completo de la barra lateral, y una conversación completada, que la barra lateral oculta por defecto, no se puede alcanzar.
- Esta versión convierte el título de la conversación en un botón: tras el título aparecen ⌄ y el número de conversaciones abiertas, con un punto ámbar sobre el número mientras otra conversación espera tu aprobación o respuesta. Al tocarlo se abre desde abajo «Conversaciones abiertas»: todas las conversaciones abiertas en el orden de las pestañas, cada una con su estado (Te necesita, En progreso, Revisión, Completado, Cancelado, Sin enviar). Toca una para cambiar a ella y × para cerrarla; también puedes empezar una conversación nueva o abrir la barra lateral con «Todas las conversaciones (con historial)». Se cierra tocando fuera, arrastrándola hacia abajo o con el gesto de volver.
- «Te necesita» solo se sabe mientras este dispositivo está conectado a esa conversación: aparece en las conversaciones abiertas al menos una vez en este dispositivo, y las demás muestran su estado guardado.
- Con «Sincronizar pestañas de conversación entre ventanas» activado (por defecto), una conversación cerrada en el móvil también se cierra en el ordenador, igual que al cerrar allí su pestaña.
- Con 768 px o más de ancho (ordenadores, tabletas) no cambia nada: sigue la barra de pestañas.
- Una conversación abierta desde la barra lateral empieza como vista previa (como en el escritorio) que la siguiente que abras reemplaza; aquí su título va en cursiva y el 📌 junto a ella la mantiene. Tocarla dos veces en la barra lateral también la mantiene, como un doble clic en el escritorio: en el móvil la barra lateral ahora espera un momento antes de cerrarse, para que el segundo toque caiga en la misma fila.
- Solicitado en [keh4l/codeg#10](https://github.com/keh4l/codeg/issues/10), [#12](https://github.com/keh4l/codeg/issues/12).

</details>

<details>
<summary><strong>Los agentes generan imágenes</strong>: detalles</summary>
<br/>

- En Configuración → Generación de imágenes, añade un servicio: elige API de OpenAI (la propia OpenAI, Grok y la mayoría de los intermediarios) o API de Gemini (la propia Google o un intermediario), deja la dirección vacía para usar la oficial y añade la clave y los nombres de modelo, como `gpt-image-2`, `grok-imagine-image-2.0` o `gemini-3-pro-image`. Puedes añadir varios. Probar genera una imagen pequeña de baja calidad para comprobar que funciona; la cobra el servicio.
- Con el interruptor de arriba de la página activado (el mismo que «Generar imágenes» en Configuración → Colaboración → Herramientas en la conversación; desactivado por defecto) y al menos un servicio con clave y modelo, los agentes que se inicien a partir de entonces tienen dos herramientas, `image_generate` e `image_get_result`. El agente puede elegir el modelo, la relación de aspecto, la resolución y un fondo transparente, y pasar imágenes de referencia para editar una existente; si no elige modelo, se usa el predeterminado de la configuración.
- El agente decide dónde se guarda la imagen; una ruta relativa se resuelve desde la carpeta de trabajo de la conversación. Sin ruta, las imágenes van a `~/.codeg/generated-images/<fecha>/`, carpeta que puedes cambiar en la configuración.
- Cada imagen tiene su tarjeta en la conversación: mientras se genera, los segundos transcurridos; después, la imagen, dónde se guardó (clic para abrirla), el servicio y el modelo, el tamaño y lo que tardó. La imagen se lee del archivo, así que al volver a cargar la conversación se sigue viendo mientras el archivo exista.
- Por defecto el agente recibe además una copia de unos 512 píxeles de ancho, para ver el resultado antes de decidir si lo cambia; esto consume parte de su contexto. Desactívalo en la configuración si el modelo del agente no puede leer imágenes.
- Una imagen suele tardar entre decenas de segundos y dos minutos. Cuando eso supera lo que el agente puede esperar por una llamada, primero recibe un id de trabajo y recoge la imagen con `image_get_result`; consulta la sección siguiente.
- La llamada la hace Codeg; el agente solo recibe el archivo de imagen. Las claves de API se guardan en el llavero del sistema (en la versión de servidor, en `tokens.json` dentro de la carpeta de datos), no en la base de datos, y no forman parte de la sincronización de configuración.

</details>

<details>
<summary><strong>Resultados para agentes con tiempos de espera cortos</strong>: detalles</summary>
<br/>

- Cuánto espera un agente por una llamada a una herramienta MCP varía: ZCode, 30 segundos; Cursor y Kimi, 60 segundos; Codex, 5 minutos; Claude Code, OpenCode, Qoder, CodeBuddy, Grok y, desde la 0.12, DeepSeek, prácticamente sin límite. En la versión oficial, `get_delegation_status` (esperar el resultado de una tarea delegada) puede esperar mucho en una sola llamada y `ask_user_question` (una pregunta para ti) espera hasta que respondas; pasado el plazo, el agente da la llamada por fallida y sigue, así que la pregunta cuenta como sin responder.
- Esta versión da a estas herramientas un límite por agente, por debajo de su plazo: por ejemplo 20 segundos en ZCode, 45 en Cursor y 4 minutos en Codex; los agentes sin límite no tienen tope, como en la versión oficial. Si se llega al tope sin resultado, la llamada vuelve y le dice al agente cómo seguir esperando.
- Preguntas: si para entonces no has respondido, la tarjeta de la pregunta sigue donde está y el agente sigue esperando con una herramienta nueva, `get_question_answer`; cuando respondes, la respuesta aparece en la tarjeta original.
- En «N en curso», cada subagente tiene un botón «Detener», y el encabezado muestra «Detener todo» cuando hay dos o más. El resultado de un subagente que detienes ahí no se devuelve al agente principal.
- Tareas delegadas: cada llamada a `get_delegation_status` espera como mucho hasta el tope y devuelve el estado actual de las tareas. Con «Despertar al agente principal cuando termine un subagente» activado, el agente principal normalmente ya no necesita esperar: los resultados le llegan solos; consulta «Los subagentes despiertan al agente principal al terminar». La generación de imágenes funciona igual; consulta la sección anterior.
- Mientras espera, el agente recibe un aviso de progreso cada 10 segundos, con lo que los agentes que alargan su plazo con el progreso, como CommandCode, pueden esperar más.

</details>

<details>
<summary><strong>Solo los agentes que usas</strong>: detalles</summary>
<br/>

- Hay 20 agentes integrados y la versión oficial los activa todos, estén instalados o no: una lista de ajustes larga, un selector de nueva conversación lleno de agentes sin instalar (la página de conversación nunca instala uno, así que elegirlo no sirve de nada) y una comprobación de cada uno cada vez que se abre la página de ajustes.
- En esta versión, Ajustes → Agentes muestra solo «Mis agentes», que se pueden seguir reordenando arrastrando. «Añadir» en su barra de título y la fila bajo la lista abren «Añadir agentes»: busca por nombre o descripción, filtra por instalados / no instalados, encuentra primero los ya instalados en este equipo y añade varios a la vez. Uno que no esté instalado se instala desde sus detalles una vez añadido.
- El interruptor de los detalles de un agente es «Mis agentes»: apágalo para quitar el agente de la lista, con opción de deshacer. Es el ajuste «activado» de la versión oficial, así que el selector de nueva conversación, la delegación y todo lo demás lo siguen.
- Al abrir la página de ajustes solo se comprueban «Mis agentes»; cualquier otro agente se comprueba cuando lo abres.
- Cuando codeg aún no tiene ajustes para un agente (una instalación nueva, o un agente integrado que añade una versión posterior), lo activa solo si detecta que está instalado aquí. Codeg considera instalado un agente cuando el adaptador ACP o la CLI que ejecuta están listos, así que una instalación nueva a menudo no tiene ninguno y la lista empieza vacía: elige en «Añadir agentes». Un agente que instales después no se añade solo, y los ajustes existentes nunca cambian.
- Al actualizar desde una versión anterior con agentes en «Mis agentes» que no están instalados, un aviso arriba de la lista ofrece una vez «Quedarme solo con los instalados» o dejarlo así (la elección se recuerda por dispositivo).
- El selector de nueva conversación termina su fila con un «+» que abre «Añadir agentes»; cuando no caben todos los agentes, está al final del menú «más». Sin ningún agente activado, el botón del selector también abre «Añadir agentes».

</details>

<details>
<summary><strong>Mantener pulsado para seleccionar texto en el móvil</strong>: detalles</summary>
<br/>

- En la versión oficial toda el área de la conversación y el cuadro de mensaje llevan menús propios, y una pulsación larga con el dedo también los abre: al mantener pulsada una respuesta unos 0,7 s aparece el menú de la conversación (Nueva conversación, Exportar conversación…); en Android además se cancela el evento que envía la pulsación larga, y con él la selección de palabras del propio móvil. Con HTTPS, una pulsación larga en el cuadro de mensaje abre su propio menú Cortar / Copiar / Seleccionar todo. Los tiradores de selección y el menú de copiar del móvil no llegan a aparecer, así que copiar texto de las respuestas y del cuadro de mensaje resulta difícil.
- Esta versión deja la pulsación larga con el dedo o con un lápiz al móvil: seleccionar, arrastrar los tiradores, copiar y pegar son los del propio móvil. El clic derecho con ratón sigue abriendo ambos menús, también en un ordenador con pantalla táctil.
- En la versión oficial, la burbuja Copiar texto / Citar / Preguntar de una respuesta seleccionada aparece junto a la selección, y el menú del móvil también, encima o debajo según decida el móvil; la página no puede leer su posición ni moverlo, así que a menudo se tapan uno al otro. En esta versión, una selección hecha con el dedo lleva estos botones y el número de caracteres seleccionados bajo el cuadro de mensaje, en lugar de la fila de carpeta y rama hasta que se quita la selección; el menú del móvil no llega más allá del cuadro de mensaje. Preguntar recibe la pregunta en esa misma fila. Con una selección hecha con el ratón, la burbuja sigue apareciendo encima.
- Los Mensajes rápidos del menú del cuadro de mensaje también están en el “+” de abajo a la izquierda del cuadro; traducir un mensaje tiene su propio botón.
- En iOS, el menú del sistema para el texto normal de una página web no tiene Seleccionar todo (solo los campos de texto lo tienen); para copiar una respuesta entera, usa el botón de copiar que hay debajo.

</details>

<details>
<summary><strong>Reiniciar el servidor desde la web</strong>: detalles</summary>
<br/>

- Desplegada en un servidor, la versión oficial no ofrece forma de reiniciar codeg desde la página web: tras cambiar un ajuste que necesita reinicio (apariencia, idioma, lista de proveedores, proxy del navegador…), o cuando el servicio falla, hay que entrar al servidor y reiniciarlo allí. Restaurar una copia de seguridad en un servidor es igual: la restauración solo se aplica tras reiniciar, pero el reinicio que llama solo acepta una actualización preparada, así que siempre termina con «no se pudo reiniciar el servicio, reinícialo a mano».
- Esta versión añade «Reiniciar codeg» bajo «Actualización de software» en Ajustes → Sistema. «Reiniciar» pide confirmación, y el diálogo indica cuántas conversaciones están en curso y se interrumpirán; después cuenta atrás, espera a que vuelva el servicio y recarga la página. Las demás ventanas abiertas también muestran «Reiniciando» en su barra de estado.
- Reinicia igual que una actualización in situ: con Docker o el supervisor (`--supervise`), el supervisor lo vuelve a iniciar tras `CODEG_RESTART_DELAY_MS`; ejecutado por su cuenta, el proceso se reinicia en el mismo lugar (systemd y similares siguen viendo el mismo proceso). Un reinicio normal no entra en el periodo de prueba de la actualización ni activa su reversión automática. No se puede reiniciar mientras una actualización se descarga o instala.
- Tras restaurar una copia de seguridad en un servidor, «Reiniciar ahora» en el panel de resultados usa el mismo reinicio, así que la restauración se aplica sola.
- Solo en las versiones de servidor: no aparece en la app de escritorio ni en un navegador conectado al servicio web integrado de un escritorio; como la actualización in situ, todavía no en servidores Windows.

</details>

<details>
<summary><strong>Los subagentes siguen donde un error los paró</strong>: detalles</summary>
<br/>

- Cuando mencionas un agente con @ en un mensaje, el agente principal le pasa el trabajo con `delegate_to_agent` y este lo hace en su propia subsesión. En la versión oficial, `resume_delegation` solo recupera subtareas canceladas o cortadas por un cierre inesperado; si el turno del subagente termina con un error (red caída, cuota o límite de uso alcanzado, sesión caducada, el proveedor rechazó la solicitud, presupuesto de tokens agotado…), queda como «fallida» y el agente principal solo puede abrir otra subsesión y empezar de cero, perdiendo el contexto del trabajo a medias.
- Esta versión trata también esos fallos como interrupciones: el resultado de la subtarea indica que su sesión y el trabajo parcial se conservan y que `resume_delegation` la continúa una vez resuelta la causa. El agente principal sigue entonces en la subsesión original con el mismo task_id, y la tarjeta original del subagente en la conversación vuelve a mostrar su progreso.
- Cómo usarlo: cuando vuelva la red, recargues la cuota o vuelvas a iniciar sesión, pide al agente principal que deje continuar al subagente.
- Una tarea que falló antes de tener sesión (por ejemplo, porque el agente no pudo arrancar) no tiene nada que continuar y hay que delegarla de nuevo. Para añadir trabajo a una subtarea que ya terminó se usa `continue_delegation`; consulta «Los subagentes trabajan en su propio worktree».

</details>

<details>
<summary><strong>Los agentes te preparan asistentes @</strong>: detalles</summary>
<br/>

- En la versión oficial, los asistentes @ (preajustes de delegación que puedes mencionar con @: un agente, cada una de sus opciones e instrucciones permanentes) solo se rellenan campo a campo en Ajustes → Colaboración → Colaboración multiagente → Asistentes; un agente no puede ayudar.
- Esta versión da a los agentes dos herramientas, `create_assistant` y `update_assistant`. Dile al agente qué asistente quieres (por ejemplo, «añade un revisor con Codex, GPT-5.5, razonamiento alto, solo lectura, para revisar diffs») y lo crea; di «cambia el revisor a GPT-5.4» o «añade una regla a las instrucciones del revisor» y lo cambia.
- Al crearlo, Codeg arranca ese agente un momento para leer sus opciones reales (tarda unos segundos). Las opciones que nombras quedan como dijiste y el resto con los valores por defecto del propio agente (los que el editor marca como Recomendado); al cambiarlo, las opciones que no nombras quedan como estaban. Si un modelo o una opción no coincide, no se guarda nada y se le dice al agente qué hay disponible.
- La conversación muestra una fila «Creando el asistente …»; al desplegarla ves el agente, las opciones y las instrucciones del asistente, y Editar abre el mismo editor que en Ajustes. El asistente nuevo aparece enseguida en el menú @ y se le puede delegar al momento.
- El interruptor es «Crear asistentes» en Ajustes → Colaboración → Herramientas en la conversación, activado por defecto; apagado, los agentes no ven las dos herramientas. Un agente configurado para manejar archivos y comandos por sí mismo no las recibe, igual que no recibe las de delegación.

</details>

<details>
<summary><strong>Ajustes agrupados</strong>: detalles</summary>
<br/>

- La navegación se agrupa bajo cinco títulos (Básico, Agentes, Contenido, Control, Conexiones y mantenimiento); las páginas y su orden son los de la versión oficial.
- Apariencia, General, Sistema, Control de versiones y Traducción reúnen los ajustes relacionados en una tarjeta con el nombre del grupo encima, y un ajuste con un solo interruptor o desplegable ocupa una fila: nombre y descripción a la izquierda, control a la derecha. Apariencia pasa de doce tarjetas a tres grupos; en Control de versiones, «Añadir cuenta» pasa a la cabecera de cada sección.
- Cada página empieza con un título y una descripción de una línea; el interruptor del proxy es como los demás; en el móvil, un desplegable o botón que no cabe pasa debajo de su descripción; en una ventana ancha del navegador, las páginas de formulario limitan su ancho y se centran.

</details>

<details>
<summary><strong>Los subagentes despiertan al agente principal al terminar</strong>: detalles</summary>
<br/>

- En la versión oficial, una vez que el agente principal envía un subagente, solo se entera del resultado consultándolo él mismo con `get_delegation_status`: o se queda bloqueado esperando, o consulta cada cierto tiempo. En cuanto cierra su turno, nadie le avisa cuando el subagente termina; tiene que esperar a que le envíes otro mensaje recordándole que lo consulte.
- Esta versión devuelve el resultado al agente principal cuando un subagente termina (o se detiene a medio camino por un error):
  - Agente principal libre: tras 2 segundos (los que terminan a la vez se juntan en uno), empieza solo un turno nuevo y el agente principal sigue a partir de los resultados;
  - Agente principal en mitad de un turno: Claude Code, Codex, Grok, Kiro y Antigravity los reciben dentro de ese turno; los demás agentes los reciben en un turno nuevo que empieza solo cuando termina ese;
  - Justo estás enviando un mensaje: los resultados van con él.
- La conversación muestra una fila «Resultados de subtareas devueltos» con cada subagente, si terminó o falló y cuánto tardó; al desplegarla ves un resumen de cada resultado y «Abrir sesión». Los que fueron con tu mensaje aparecen debajo de él como «N resultados de subtareas adjuntos». Esa fila la envía codeg al agente principal: no se reenvía a los canales de chat como si la hubieras escrito tú ni se usa para poner título a la sesión.
- Los resultados que el agente principal ya obtuvo por su cuenta con `get_delegation_status` o `cancel_delegation` no se vuelven a enviar; las subtareas canceladas por el agente principal o por ti no se envían.
- Al pulsar Detener se paran el agente principal y los subagentes que tiene en marcha, como en la versión oficial; los resultados que ya habían terminado pero aún no se habían entregado van con tu siguiente mensaje. Cuando el turno del agente principal termina con un error (límite de uso, red caída…), la versión oficial cancela también sus subagentes; esta versión los deja terminar. En ese caso, y tras 20 continuaciones automáticas seguidas, ya no empieza solo un turno nuevo: los resultados esperan a tu siguiente mensaje, y así lo indica una nota junto a «N en curso».
- El interruptor es «Despertar al agente principal cuando termine un subagente» en Ajustes → Colaboración → Colaboración multiagente → General, activado por defecto, y se aplica a las sesiones que empiecen después; apagado, funciona como en la versión oficial: el agente principal tiene que consultarlo por su cuenta.

</details>

<details>
<summary><strong>Los subagentes trabajan en su propio worktree</strong>: detalles</summary>
<br/>

- En la versión oficial todos los subagentes trabajan en la carpeta de trabajo del agente principal, así que dos subagentes enviados a la vez a cambiar código tocan los mismos archivos; el modelo se fija de antemano en el asistente @ o en Ajustes y el agente principal no puede elegirlo según la tarea; y si, una vez terminado, hay que cambiar algo más, toca abrir una sesión nueva y explicarlo todo otra vez.
- Esta versión añade tres parámetros a `delegate_to_agent`:
  - `isolation: "worktree"`: el subagente trabaja en un worktree de git nuevo, en la rama `delegate/<id>`, creado desde el commit en el que está el agente principal; los cambios sin confirmar del agente principal no están en él, y la respuesta a la delegación lo advierte. El worktree va en la «Ubicación del worktree» de «Tareas pendientes» (junto al repositorio si no está configurada), en una carpeta llamada `<repo>-delegate-<id>`. Cuando el subagente termina, su resultado indica la ruta, la rama y qué cambió; el agente principal lo revisa y lo fusiona con git, o te lo deja a ti. Solo funciona en un repositorio git con al menos un commit.
  - `model` y `config`: un modelo y unas opciones solo para esta delegación (como `{"reasoning_effort": "high"}`), aplicados sobre los valores por defecto del asistente @ o de Ajustes; las opciones que no se indican quedan como estaban. Cuando el subagente arranca, se comprueban contra las opciones que ofrece de verdad: si alguna no coincide, no se le deja empezar y se le dice al agente principal qué hay disponible; las opciones que no tiene en absoluto se ignoran, y la respuesta lo indica.
- Herramienta nueva, `continue_delegation`: encarga más trabajo a una subtarea que ya terminó (completada, fallida o cancelada), en su subsesión original, conservando el contexto, la carpeta de trabajo, el modelo y las opciones; el resultado también vuelve al agente principal. Cada encargo es una ronda nueva con un task_id nuevo. Reparto con `resume_delegation`: resume sigue lo que se cortó a medias; continue pide más cuando ya está hecho.
- La fila de la delegación muestra tras el título etiquetas con el modelo, la rama y «Ronda N»; al desplegarla ves el modelo, las opciones y el estado del worktree (de qué commit salió, cuántos archivos cambiaron). «Abrir» abre el worktree en el espacio de trabajo (ahí se revisan los cambios, se hace commit y se fusiona) y «Eliminar worktree» lo borra, también con su rama si quieres.
- Los worktrees no se borran solos. Al eliminar una subsesión que usó uno, el cuadro de confirmación añade «Eliminar también su worktree»; si dentro hay cambios sin confirmar, viene desmarcado por defecto e indica cuántos.

</details>

<details>
<summary><strong>Intervenir en cualquier momento</strong>: detalles</summary>
<br/>

- En la versión oficial, Enter pone el mensaje en cola mientras el agente responde; intervenir está escondido tras la flechita junto a Enviar y solo entra directamente en el turno con Claude Code y Codex. Los demás agentes necesitan activar “Comentarios en vivo” en ajustes y solo reciben una nota que quizá lean cuando la consulten. La cola vive en el navegador actual y se pierde al recargar, y tras detener el turno el siguiente mensaje en cola sale enseguida.
- Esta versión sigue a T3 Code:
  - El botón de enviar: Detener con el cuadro vacío; con contenido, el icono dice qué hará un clic: intervenir (↱) o poner en cola (lista +). Al mantener ⌘/Ctrl el icono cambia, y ⌘/Ctrl+clic hace lo otro; en el móvil, una pulsación larga en Enviar elige lo otro para ese mensaje.
  - Intervenir es lo predeterminado; “Enviar mientras el agente responde” en Ajustes → General → Pestañas y entrada lo cambia a la cola, solo en este dispositivo.
  - Teclas (se cambian en Ajustes → Atajos): Enter envía de la forma predeterminada; ⌘/Ctrl+Enter de la otra; ⌘/Ctrl+Shift+Enter mete en el turno el mensaje en cola más antiguo; Alt+↑ con el cursor al inicio del cuadro edita el último en cola.
  - Los comandos con barra siempre van a la cola, y también una intervención mientras el agente compacta su contexto.
- Cómo llega una intervención: Claude Code, Codex, Grok, Kiro (solo texto) y Antigravity 1.5.0+ la reciben en el turno en curso y la leen tras el paso actual. Cualquier otro agente detiene el turno y empieza de nuevo en la misma sesión con tu mensaje: la respuesta interrumpida se pliega en “Intento interrumpido por un mensaje”, el paso en curso se pierde y los subagentes que delegó siguen trabajando. Grok sin intervención nativa solo usa la cola (su cancelación también detiene la herramienta en marcha).
- Un mensaje con intervención se marca “Intervención”, y “Intervención · pendiente de lectura” mientras va de camino; las marcas sobreviven a una recarga.
- La cola vive en el servidor: todas las ventanas y dispositivos ven la misma, y sobrevive a recargas y reinicios. En el ordenador se muestra con burbujas punteadas al final de la conversación, en el móvil encima del cuadro de texto; cada mensaje se puede enviar ahora (al turno en curso, o como turno nuevo si está inactivo), editar, quitar y reordenar arrastrando. El servidor envía el siguiente cuando un turno termina con normalidad, aunque todos los navegadores estén cerrados, y lleva los resultados de subtareas que aún no se entregaron.
- Detener, un turno que acaba en error (límite de uso, red…) o reiniciar el servidor pausa la cola: encima del cuadro aparece “Cola en pausa” con “Continuar”; Continuar, Enter con el cuadro vacío o un mensaje nuevo la reanudan. Si al detener había una intervención de camino, se avisa de que no se entregó, con un botón para devolverla al cuadro.
- Los “Comentarios en vivo” (notas) de la versión oficial ya no existen: no hay interruptor en ajustes y los agentes ya no reciben la herramienta `check_user_feedback`.

</details>

<details>
<summary>Detalles de <strong>Vista compacta estilo T3</strong></summary>
<br/>

- <strong>Activa por defecto y reversible</strong>: cambia al instante entre «Compacto (estilo T3)» y «Línea de tiempo (clásico)» en Ajustes → Apariencia → Estilo de conversación (guardado por dispositivo).
- <strong>Línea en vivo y plegado automático</strong>: mientras el agente trabaja, «Trabajando durante Xs» es un temporizador con un destello que lo recorre; cada grupo de herramientas terminado se resume en una línea («Leyó 2 archivos, buscó una vez»), el texto intermedio sigue en su sitio y el paso en curso tiene su propia línea con destello: al pulsarla se abre ese grupo. Al terminar, la misma línea pasa a «Trabajó durante Xs ›» y lo anterior a la respuesta se pliega; al abrirla vuelven esas líneas de resumen, y cada grupo abre sus pasos en una caja corta con desplazamiento propio y bordes difuminados. Abrir o cerrar mantiene en su sitio la línea pulsada. Los errores sin resolver, permisos pendientes, preguntas, planes, subagentes activos e imágenes generadas siempre quedan fuera del pliegue; una ronda que abriste mientras se ejecutaba sigue abierta.
- <strong>Cuatro niveles de herramientas</strong>: Mostrar todo, Ocultar exitosas, Ocultar todo y Modo zen en Ajustes o en el menú «…» de la cabecera.
- <strong>Árbol de archivos y panel diff</strong>: directorios encadenados compactados, desplegado hasta 8 archivos y virtualizado sobre 250 filas. Clic abre el diff; nuevos HTML/Markdown/imágenes tienen vista previa integrada; las filas de edición también abren el diff en un clic.
- <strong>Burbujas agrupadas y pie al pasar el cursor</strong>: mensajes seguidos agrupados, collage de imágenes dentro de la burbuja, plegado solo sobre 22rem y acciones al pasar el cursor (hora, copiar, editar en compositor sin revertir archivos). El pie de respuesta aparece al pasar el cursor (siempre visible en la última); tok/s oculto por defecto. Enviar fija tu mensaje a 24px del borde superior.
- <strong>Minimapa, búsqueda total, citas y tema Carbón</strong>: minimapa en escritorio, ⌘/Ctrl+F busca en todo el historial (cargando turnos antiguos y abriendo pliegues), citas clicables que saltan y resaltan 2s el origen, ajuste de líneas y pegado en nueva terminal sin ejecutar en bloques shell, y tema negro puro «Carbón».

</details>

<details>
<summary><strong>Acceso remoto más ágil</strong>: detalles</summary>
<br/>

- Por un enlace público con mucha latencia y pérdida de paquetes, la versión oficial va lenta: el texto en streaming sale en una trama de WebSocket por cada trozo pequeño, y cada trama espera la confirmación de la anterior (Nagle), así que el texto llega a golpes cada medio segundo. Un solo paquete perdido hace que el control de congestión por defecto reduzca a la mitad la velocidad de envío, y los 1,9 MB de scripts de la primera carga tardan más de veinte segundos. Una reconexión vuelve a descargar la instantánea entera de la conversación. Las capturas de pantalla van incrustadas en la conversación como base64 y se envían completas cada vez que se abre. Al abrir una conversación, el servidor analiza el mismo registro tres veces. Al salir de una conversación se desconecta su agente, así que al volver hay que reconectar y recargarlo todo.
- Lo que consigue esta versión (enlace simulado: 368 ms de ida y vuelta, 7 % de pérdida de paquetes, agente simulado; una conversación de 150 turnos con 10 capturas):

  |  | Versión oficial | Esta versión |
  | --- | --- | --- |
  | De la primera apertura a poder escribir | 24,8 s | 8–14 s |
  | De recargar a poder escribir | 2,7 s | 1,1–1,2 s |
  | De abrir una conversación larga a ver su último turno | 12,3 s | 0,8 s |
  | Volver a una conversación que acabas de ver | 6,3 s (lo recarga todo) | 0,2 s |
  | Intervalo entre actualizaciones del texto al responder (mediana / percentil 95) | 366 / 460–731 ms | 34–38 / 66–100 ms |

- Conexión: el servidor desactiva Nagle y usa el control de congestión BBR (la pérdida de paquetes ya no se toma por congestión), y mantiene pequeña la cola de datos sin enviar del kernel, para que un latido nunca espere detrás de un bloque grande. El WebSocket incorpora el subprotocolo `codeg-events.v2`: el texto en streaming se junta en una trama cada 100 ms, y las tramas grandes se comprimen y se envían por partes. La página comprueba la conexión cada 5 segundos y solo la da por perdida tras 15 segundos sin respuesta; entonces reconecta enseguida y recibe solo los eventos que se perdió. Si se recupera en menos de 8 segundos no aparece ningún aviso, y un corte de 3 u 8 segundos no necesita reconexión. La app de escritorio conectada a un servidor remoto también usa v2.
- Abrir una conversación: las capturas se cargan aparte y bajo demanda, primero como miniatura, y no se vuelven a descargar una vez vistas. La salida de una herramienta de más de 24 KB llega primero solo con el principio y el final, y el texto completo se pide al desplegarla. La primera pantalla trae solo los últimos turnos, según su tamaño. El servidor guarda en caché las conversaciones de Claude Code ya analizadas y solo las vuelve a analizar si el registro cambia.
- Cambiar de conversación: al salir de una conversación, su agente queda aparcado en lugar de desconectarse, y al volver se retoma directamente. Al pulsar una conversación de la barra lateral o pasar el puntero por encima ya se empieza a traer su contenido. Los agentes aparcados ocupan memoria, así que el servidor mantiene como mucho 6 inactivos y, por encima de eso, desconecta los que llevan más tiempo sin usarse.
- Inicio: los archivos estáticos con hash se guardan en caché de forma permanente; al recargar se entra directamente al espacio de trabajo; las 20 peticiones que necesita el inicio se juntan en una y se envían antes de que terminen de descargarse los scripts de la página.
- Variables de entorno del servidor (rara vez hace falta cambiarlas):

  | Variable | Por defecto | Qué hace |
  | --- | --- | --- |
  | `CODEG_WS_COALESCE_MS` | `100` | Ventana para juntar el texto en streaming en una trama (ms, máximo 1000; `0` no junta) |
  | `CODEG_TCP_CONGESTION` | `bbr` | Control de congestión de las conexiones web; si el kernel no lo tiene, se usa el del sistema; vacío u `off` lo deja sin cambiar |
  | `CODEG_TCP_NOTSENT_LOWAT` | `65536` | Máximo de bytes sin enviar que el kernel retiene por conexión; `0` sin límite |
  | `CODEG_ACP_MAX_IDLE_CONNECTIONS` | `6` | Cuántos agentes aparcados inactivos se mantienen; `0` sin límite (los inactivos se siguen liberando por tiempo) |
  | `CODEG_ACP_IDLE_HOLD_GRACE_SECS` | `90` | Segundos sin usarse tras los que un agente aparcado cuenta como inactivo |
  | `CODEG_DETAIL_CACHE_ENTRIES` | `6` | Cuántas conversaciones de Claude Code analizadas se guardan en caché; `0` sin caché |

</details>

<details>
<summary><strong>Los botones responden al momento y las respuestas salen a ritmo constante</strong>: detalles</summary>
<br/>

- En la versión oficial, cada botón espera la respuesta del servidor: con 368 ms de ida y vuelta, la tarjeta de un permiso aprobado tarda 0,4 s en desaparecer, renombrar y eliminar tardan medio segundo, y Detener no da señal de haberse pulsado. Una petición que se pierde por el camino simplemente falla. Cuando la red da tirones, las respuestas saltan a ráfagas.
- Esta versión:
  - Renombrar, eliminar, fijar, cambiar el estado, el color, el alias y el agente predeterminado de una carpeta, quitar una carpeta del espacio de trabajo, aprobar permisos, responder preguntas y aprobar planes: el cambio se hace en local y se ve en cuanto pulsas. Si el servidor lo rechaza y la pantalla sigue mostrando tu cambio, se deshace con un aviso; un modelo o una opción que no se aplicó también vuelve a su valor anterior.
  - Ante un error de red, sus peticiones se reintentan hasta dos veces. Las que crean algo (enviar un mensaje, una conversación nueva, intervenir, poner en cola) llevan una clave de idempotencia: el servidor ejecuta una repetición solo una vez y responde con el primer resultado, así que no aparece ningún mensaje ni conversación duplicados.
  - Detener gira en cuanto lo pulsas, para indicar que se está deteniendo. Solo detiene el turno en el que lo pulsaste: si ese turno ya terminó y empezó el siguiente mensaje en cola, ese sigue.
  - Si cambias de modo y luego envías, el modo va con el mensaje y se ahorra un viaje de ida y vuelta.
  - Intervenir y poner en cola vacían el cuadro de mensaje al momento; un mensaje que no llegó vuelve al cuadro, con imágenes y citas incluidas.
  - Crear o bifurcar una conversación ya no vuelve a cargar toda la lista de conversaciones.
- Medido (mismo enlace): de aprobar un permiso a que desaparezca la tarjeta, 0,42 s → 5 ms; renombrar, 0,49 s → 0,06–0,09 s; eliminar, 0,45 s → 0,07–0,2 s; reacción de Detener, 0,46 s → 0,03–0,07 s.
- Texto a ritmo constante: con la red lenta, la respuesta se muestra al ritmo al que ha ido llegando últimamente, un poco por detrás. Cuánto por detrás se decide según la pausa más larga reciente de ese enlace (como mucho 1,5 s). Con la red fluida no se retiene nada, como antes. Antes de que aparezca una tarjeta de herramienta, una solicitud de permiso o el final del turno, se muestra primero todo el texto retenido, así que el orden no cambia. Medido en el mismo enlace: mediana del intervalo entre actualizaciones del texto 100 → 34–38 ms, percentil 95 190–214 → 66–100 ms. Se desactiva en Configuración → Apariencia → Texto en streaming suave, y solo afecta a este dispositivo.

</details>

<details>
<summary><strong>Se ve en marcha cuando el agente sigue por su cuenta</strong>: detalles</summary>
<br/>

- La versión oficial solo cuenta como en marcha los turnos que envía codeg. Un turno que empieza el propio agente —Claude Code retomando el trabajo al terminar un comando en segundo plano (`run_in_background`), un Monitor o un subagente en segundo plano, o Codex siguiendo con un `/goal` sin terminar— deja la conversación como si hubiera terminado (Revisión): el cuadro de mensaje muestra Enviar, no hay forma de detener el turno y no llega aviso al acabar. Además, el turno de Codex se descarta y solo queda un botón «Cargar actividad en segundo plano».
- Esta versión trata esos turnos como cualquier otro: al empezar, la conversación pasa a En progreso, su pestaña y la barra lateral la muestran en marcha y el cuadro de mensaje ofrece Detener; al terminar pasa a Revisión y avisa como cualquier turno, y se envían los mensajes en cola.
- Claude Code: el contenido del turno se sigue leyendo de su registro de conversación y se muestra en directo, como antes. El botón de detener de la fila «Claude Code está trabajando» en la lista de tareas en segundo plano hace lo mismo que el del cuadro de mensaje. Requiere claude-agent-acp 0.97.0 o posterior (esta versión trae 0.110.1).
- Codex: el contenido del turno se muestra en directo. El inicio y el final se toman del estado del hilo que informa Codex, lo que requiere codex-acp 2.3.0 o posterior (esta versión trae 2.10.0).
- Si envías un mensaje mientras corre uno de esos turnos, primero se cierra ese turno y luego el mensaje pasa al agente: Claude Code lo incorpora al turno en curso y lo responde ahí, y Codex también sigue con él.
- El turno que Grok empieza solo al acabar un flujo de trabajo en segundo plano ya se veía en marcha en la versión oficial; esta versión también pasa la conversación a En progreso.

</details>

### Publicación

|  | Esta versión | Versión oficial |
| --- | --- | --- |
| Descargas y actualizaciones | [Releases](https://github.com/keh4l/codeg/releases) de este repositorio, firmadas con la clave propia de este fork | Releases de [spacering-net/codeg](https://github.com/spacering-net/codeg/releases) |
| Versión | `<versión original>-<n>`: `0.33.0-2` es la 2.ª versión basada en la 0.33.0 original | p. ej. `0.33.0` |
| Notarización en macOS | No; hay que permitirla una vez al abrirla por primera vez (ver [Instalación](#instalación)) | Sí |
| Imagen de Docker | No | Sí |

Las actualizaciones no se cruzan: esta versión nunca se actualiza a una versión oficial, ni una versión oficial a esta. La rama `keh4l` es la rama `main` del proyecto original más los cambios de arriba.

## Instalación

### Escritorio

Descarga el instalador más reciente desde [Releases](https://github.com/keh4l/codeg/releases/latest):

| Sistema | Instalador |
| --- | --- |
| macOS (Apple Silicon o Intel) | `.dmg` |
| Windows (x64 o ARM64) | `-setup.exe` |
| Linux | `.deb`, `.rpm` o `.AppImage` |

Se instala como la misma aplicación que el Codeg oficial: lo sustituye y conserva tus conversaciones y ajustes.

> [!NOTE]
> En macOS, si al abrirla por primera vez dice que la app está dañada o que no se puede abrir, ejecuta esto una vez, o permítela en Ajustes del Sistema → Privacidad y seguridad:
>
> ```bash
> xattr -cr /Applications/codeg.app
> ```

### Servidor

Linux o macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Ambos instalan desde las versiones de este repositorio, y el actualizador integrado del servidor también las usa.

### Volver a la versión oficial

> [!WARNING]
> Haz primero una copia de seguridad de tus datos de Codeg. Esta versión añade migraciones de base de datos que la oficial no tiene (las tablas de la traducción, entre otras), y una versión oficial puede negarse a arrancar con esos mismos datos.

## Documentación

Para funciones, configuración y uso, consulta el [README](https://github.com/spacering-net/codeg/blob/main/docs/readme/README.es.md) oficial y [docs.codeg.app](https://docs.codeg.app). Describen la versión oficial; las diferencias están arriba.

## Licencia y agradecimientos

Apache-2.0, consulta [LICENSE](../../LICENSE). Codeg lo crean [xintaofei](https://github.com/xintaofei) y sus colaboradores; esta versión solo le añade cosas. Codeg se apoya en [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) y [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
