# 🎁 Intercambio Familiar

Página para el intercambio de regalos de la familia. El evento avanza en 4 fases que controla el organizador:

1. **Preparando:** el organizador carga la lista de invitados agrupados por familia.
2. **Quinielas abiertas:** cada quien entra con su nombre y un PIN de 4 dígitos, y llena todas las quinielas que quiera (quién cree que le regalará a quién). **Todavía no existe ningún papelito**, así que nadie, ni el organizador, puede hacer trampa.
3. **Sorteo en curso:** el organizador presiona **Iniciar sorteo**. En ese momento se cierran las quinielas y se generan los papelitos al azar. Cada invitado puede **sacar su papelito** y ver a quién le toca regalar.
4. **Resultados revelados:** el día del intercambio se ve quién le regaló a quién y la tabla de aciertos de las quinielas.

## Stack

- Node.js 22 + Express, un solo proceso.
- SQLite integrado de Node (`node:sqlite`), un archivo en `data/`. **No necesitas levantar otra base de datos.**
- Frontend HTML/CSS/JS sin build, con un sistema visual inspirado en las guías de Apple: tipografía del sistema (SF en iPhone/Mac), listas agrupadas, hojas inferiores, alertas, PIN tipo iOS y modo oscuro automático.

## Correr local

```bash
npm install
ADMIN_PASSWORD=secreto npm start
```

- Invitados: http://localhost:3000
- Organizador: http://localhost:3000/admin.html

## Levantar en el VPS (Docker)

Corre en el VPS de BitBite, detrás de su Caddy, como proyecto Docker aparte. El front (`public/`) y el API salen del mismo contenedor. Los pasos completos, cómo actualizar, respaldar y quitarlo en diciembre están en [DESPLIEGUE.md](DESPLIEGUE.md).

Para probar con Docker en tu Mac:

```bash
docker network create bitbite-proxy   # una vez
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

## Cómo funciona el sorteo

- Al pulsar **Iniciar sorteo** se genera de una sola vez un sorteo válido: cada quien da exactamente un regalo y recibe exactamente uno, nadie se regala a sí mismo y, si la regla está activa, nadie le regala a alguien de su propia familia. Así nunca hay "callejones sin salida" cuando los últimos sacan papelito.
- El sorteo es **uniforme**: todas las combinaciones válidas tienen la misma probabilidad, con azar criptográfico (`crypto.getRandomValues`). El algoritmo vive en `public/draw.js` y es el mismo que usa el botón "Al azar" de las quinielas, que es independiente del sorteo real (éste ni siquiera existe mientras las quinielas están abiertas).
- Antes de guardar, el servidor vuelve a verificar el sorteo; además la base de datos impide que alguien dé o reciba dos papelitos.
- "Sacar papelito" revela la asignación de esa persona y lo registra. En Participantes, el organizador ve quién ya vio su papelito y quién falta (sin ver a quién le tocó).
- La primera vez cada invitado crea su PIN y lo confirma; después de 5 intentos fallidos se bloquea 10 minutos, y cada bloqueo siguiente dura el doble. La contraseña del organizador también se bloquea tras 8 intentos fallidos.
- **Nota "¿Quién es?"** (Participantes → nombre): para invitados que no todos conocen, p. ej. "Es la mamá de Anette". La ve quien le toque regalarle en su papelito, y aparece bajo su nombre en las quinielas (no en la pantalla de revelación, que se proyecta frente a todos). En "¿Qué familias la ven?" puedes marcar sólo algunas familias: las demás no la ven ni en su papelito ni en las quinielas (sin marcar ninguna, la ven todos). Se puede cambiar en cualquier fase y se conserva si se vuelve a guardar la lista.
- Si alguien olvida su PIN, el organizador lo restablece desde el panel (Participantes → nombre → Restablecer PIN).
- Si alguien eligió un nombre que no era suyo, restablecer el PIN cierra esa sesión.
- **Reiniciar sorteo** borra papelitos y quinielas (conserva lista y PINs) y regresa a "Preparando".
- **Costo por quiniela** (Ajustes): los invitados ven el costo antes de guardar cada quiniela, con el aviso de que se paga el día de la cena, y su total a pagar. El panel muestra cuánto debe cada quien y la bolsa total. Cada quiniela guarda el costo vigente al crearla, así que cambiarlo sólo afecta las nuevas; se bloquea al iniciar el sorteo.
- En las quinielas se puede predecir cualquier pareja, incluso dentro de la misma familia; lo único prohibido es regalarse a sí mismo. El botón "Al azar" de las quinielas sigue esa misma regla. La regla de familias sólo aplica al sorteo real.
- "Quinielas mínimas" es una referencia: el panel muestra quién no la ha llenado y avisa antes de iniciar el sorteo.
- **Pantalla de revelación** (botón en el panel desde que inicia el sorteo): vista a pantalla completa para proyectar en la cena. Se revela, con animación, a quién le regala cada invitado. El flujo automático (barra espaciadora o el botón dorado) sigue la dinámica de la cena: quien recibe es el siguiente en dar; sólo al empezar o cuando se cierra un ciclo se elige a alguien al azar. Tocar cualquier otro nombre lo revela y la cadena continúa desde ahí; la tabla de quinielas se recalcula en vivo con lo revelado hasta ese momento y al final se anuncia la quiniela ganadora con podio. Antes de revelar resultados pide otra vez la contraseña. El avance se guarda en ese dispositivo para retomarlo si se cierra.

> Nota: la pestaña **Sorteo** del panel está bloqueada: para ver quién le regala a quién hay que escribir otra vez la contraseña del organizador (5 intentos fallidos la bloquean 15 min). Muestra además la verificación del sorteo (todos dan, todos reciben, sin repetidos). Se vuelve a bloquear al cambiar de pestaña o recargar. El archivo SQLite también guarda los papelitos: no lo abras si participas 😉

## Pruebas

```bash
npm test
```

Verifican que el sorteo siempre sea válido, que sea uniforme (prueba chi-cuadrada contra todas las combinaciones posibles) y recorren el flujo completo contra el servidor: quinielas inválidas rechazadas, quinielas cerradas al iniciar el sorteo, papelitos, resultados y bloqueos de PIN/contraseña.

## Formato de la lista

```
Familia García: Juan, María, Pedro
Familia López: Ana, Luis
# Familia Pérez
Rosa
Toño
```
