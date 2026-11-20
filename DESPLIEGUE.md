# Despliegue en el VPS (junto a BitBite, sin tocarlo)

**Front y API van juntos.** No hay que subir el front por separado: Express sirve la
carpeta `public/` (HTML/CSS/JS sin build) y el API `/api/*` desde el mismo contenedor.
Un solo dominio, un solo `docker compose up`.

```
Internet ──443──> Caddy de BitBite ──red bitbite-proxy──> intercambio:3000 (Express + public/ + SQLite)
                    ├─> api:4000        (BitBite producción, intacto)
                    └─> demo-api:4000   (BitBite demo, intacto)
```

Lo único de BitBite que se toca es **un bloque al final del Caddyfile**. Se quita en diciembre.

Abajo se usa `intercambio.bitbite.mx`. Si usas otro dominio, cámbialo en los pasos 1, 6 y 7.

---

## 0. En tu Mac: subir a GitHub

Crea en GitHub un repositorio **privado** vacío (por ejemplo `intercambio`), sin README. Luego:

```bash
cd ~/Documents/Projects/teckystems/NEW-YEAR
git init -b main
git add .
git status          # revisa que NO aparezcan .env, data/intercambio.db ni node_modules
git commit -m "Intercambio familiar"
git remote add origin git@github.com:TU_USUARIO/intercambio.git
git push -u origin main
```

## 1. Cloudflare: el subdominio

DNS → Add record: **A**, nombre `intercambio`, IPv4 `2.25.232.58`, **Proxy status: DNS only (nube gris)**.
Igual que `api`, para que Caddy saque su certificado sin problemas.

Comprueba desde la Mac (puede tardar unos minutos):

```bash
dig +short intercambio.bitbite.mx @1.1.1.1
```

## 2. VPS: llave de solo lectura para GitHub

En la terminal de Hostinger (como root):

```bash
ssh-keygen -t ed25519 -f /root/.ssh/github_intercambio -N "" -C "VPS intercambio"
cat /root/.ssh/github_intercambio.pub
```

Copia esa línea en GitHub → repo → Settings → Deploy keys → Add deploy key
(título "VPS Hostinger", **sin** "Allow write access").

## 3. VPS: clonar

```bash
git clone -c core.sshCommand="ssh -i /root/.ssh/github_intercambio -o IdentitiesOnly=yes" \
  git@github.com:TU_USUARIO/intercambio.git /root/intercambio
cd /root/intercambio
```

(`-c core.sshCommand` deja la llave guardada en el repo, así `git pull` funciona después sin más.)

## 4. VPS: contraseña del organizador y carpeta de datos

```bash
cd /root/intercambio
echo "ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')" > .env
chmod 600 .env
cat .env            # guarda esta contraseña: es la del panel /admin.html
chown 1000:1000 data   # el contenedor corre como usuario "node" (uid 1000), no root
```

**(Opcional) Subir la base que ya tienes en la Mac** si ya cargaste invitados ahí.
Si no, sáltate esto y empieza limpio en el servidor.
Primero detén el servidor local (`Ctrl+C`), para que se cierre bien y no queden datos en el `-wal`. Luego, desde la Mac:

```bash
scp -i ~/.ssh/id_ed25519_bitbite ~/Documents/Projects/teckystems/NEW-YEAR/data/intercambio.db bitbite@2.25.232.58:/tmp/
```

Y en el VPS como root (antes del paso 5):

```bash
mv /tmp/intercambio.db /root/intercambio/data/ && chown 1000:1000 /root/intercambio/data/intercambio.db
```

## 5. VPS: levantar el contenedor

```bash
cd /root/intercambio
docker compose up -d --build
docker compose ps        # espera a que diga "healthy" (≈15 s)
docker compose logs --tail 20
```

Si dice `network bitbite-proxy not found`, BitBite no está arriba; no debería pasar.

## 6. VPS: agregar el dominio a Caddy

Se **agrega al final** con `>>`. No uses `sed -i` ni otro editor que reemplace el archivo:
Caddy lo tiene montado como archivo suelto y dejaría de ver los cambios.

```bash
cat >> /root/BITBITE-API/deploy/Caddyfile <<'EOF'

# >>> intercambio (temporal, quitar en diciembre)
intercambio.bitbite.mx {
	encode zstd gzip
	reverse_proxy intercambio:3000
}
# <<< intercambio
EOF

docker exec bitbite-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec bitbite-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

`reload` aplica el cambio sin cortar el API de BitBite. Si `validate` marca error, **no** hagas
reload: Caddy sigue funcionando con la configuración anterior.

## 7. Probar

```bash
curl -s https://intercambio.bitbite.mx/healthz        # {"ok":true}
curl -s https://api.bitbite.mx/api/v1/health           # BitBite sigue bien
```

- Invitados: https://intercambio.bitbite.mx
- Organizador: https://intercambio.bitbite.mx/admin.html

---

## Actualizar después de un cambio

En la Mac: commit y `git push`. En el VPS:

```bash
cd /root/intercambio && git pull && docker compose up -d --build
```

La base (`data/`) no se toca al actualizar.

## Respaldo

Detiene la app unos segundos para copiar la base completa:

```bash
cd /root/intercambio && mkdir -p respaldos && docker compose stop && \
  cp data/intercambio.db respaldos/intercambio-$(date +%F-%H%M).db && docker compose start
```

Para bajarlo a la Mac: `scp` desde `/root/intercambio/respaldos/` (pásalo antes a `/tmp` y dale permisos a `bitbite`).

## Ojo con BitBite

El Caddyfile está en el repo de BitBite (`/root/BITBITE-API`). Mientras tenga el bloque del
intercambio, `git status` ahí lo mostrará como modificado. Si un `git pull` de BitBite se queja
del Caddyfile, quita el bloque (paso de abajo), haz el pull y vuelve a agregarlo (paso 6).

---

## En diciembre: quitarlo del servidor

```bash
cd /root/intercambio && mkdir -p respaldos && docker compose stop && cp data/intercambio.db respaldos/final.db   # (opcional) último respaldo
docker compose down --rmi local

# Quitar el bloque de Caddy sin cambiar el archivo montado (cat > conserva el mismo archivo)
F=/root/BITBITE-API/deploy/Caddyfile
sed '/# >>> intercambio/,/# <<< intercambio/d' "$F" > /tmp/Caddyfile.nuevo && cat /tmp/Caddyfile.nuevo > "$F" && rm /tmp/Caddyfile.nuevo
docker exec bitbite-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec bitbite-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
cd /root/BITBITE-API && git status      # el Caddyfile ya no debe aparecer modificado

rm -rf /root/intercambio /root/.ssh/github_intercambio /root/.ssh/github_intercambio.pub
```

Luego: borra el registro `intercambio` en Cloudflare y la deploy key en GitHub. El código queda en GitHub.
