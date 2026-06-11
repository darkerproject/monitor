# Darker Monitor

Sala de llamadas para músicos y productores, de **Darker Project**. Permite compartir pantalla, transmitir el audio del DAW como fuente independiente (sin filtros, en estéreo) y monitorear los niveles de entrada en tiempo real.

## Estructura del proyecto

```
darker-monitor/
├── index.html          # Estructura de la página (home + sala)
├── css/
│   └── styles.css      # Estilos (tema claro/oscuro, controles, sheet de ajustes)
├── js/
│   └── app.js          # Lógica: WebRTC (PeerJS), dispositivos, DAW, medidores
├── assets/
│   └── dp-logo.png     # Logo de Darker Project
└── README.md
```

## Despliegue (GitHub + Vercel)

1. Sube el contenido de esta carpeta a un repositorio de GitHub (el `index.html` debe quedar en la raíz del repo).
2. En Vercel: **Add New → Project**, importa el repo. No requiere configuración: es un sitio estático sin build.
3. Cada push a GitHub redespliega automáticamente.

> La app **requiere HTTPS** (Vercel lo da automático). Sin HTTPS el navegador bloquea micrófono, cámara y los nombres reales de los dispositivos.

## Uso

1. Abre la URL y pulsa **Iniciar sala**. Acepta los permisos de micrófono y cámara.
2. Copia el enlace de invitación y envíalo al cliente. Al abrirlo (computadora o teléfono), se le piden los mismos permisos y entra a la sesión.
3. **Compartir el DAW** (Mac): pon la salida de Logic en un dispositivo virtual (ZoomAudioDevice, BlackHole o Loopback). En **Ajustes → Entrada del DAW**, selecciona ese dispositivo. La mezcla se transmite sin filtros y en estéreo, y tú también la escuchas a través del navegador.
4. **Compartir pantalla** es independiente del audio del DAW.

## Notas técnicas

- Conexión P2P con [PeerJS](https://peerjs.com) (broker público). En redes muy restrictivas (NAT estricto) la conexión puede fallar; lo resolvería un servidor TURN propio.
- Audio por WebRTC/Opus forzado a estéreo y ~256 kbps (alta calidad, no lossless).
- La conexión lleva siempre dos pistas de audio (voz + DAW); la del DAW va en silencio hasta activarse, lo que permite encenderla en plena llamada sin renegociar.
- El selector de altavoz no está disponible en iOS/Safari (limitación del navegador).
