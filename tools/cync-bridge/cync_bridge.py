"""
SpotiEcho Cync Bridge (GE Cync / C by GE Light Sync)
Syncs real-time album cover dominant tint with your Cync smart bulbs.
"""
import os
import sys
import json
import asyncio
from aiohttp import web, ClientSession
from pycync import Auth, Cync, User, CyncLight
from pycync.exceptions import TwoFactorRequiredError, AuthFailedError, BadRequestError

SESSION_FILE = os.path.join(os.path.dirname(__file__), "cync_session.json")
PORT = 8088

app_state = {
    "cync": None,
    "lights": [],
    "last_rgb": None
}

def load_saved_session():
    if os.path.exists(SESSION_FILE):
        try:
            with open(SESSION_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return User(
                    access_token=data["access_token"],
                    refresh_token=data["refresh_token"],
                    authorize=data["authorize"],
                    user_id=data["user_id"],
                    expires_at=data.get("expires_at")
                )
        except Exception as e:
            print(f"[Cync] Error reading session file: {e}")
    return None

def save_session(user: User):
    try:
        data = {
            "access_token": user.access_token,
            "refresh_token": user.refresh_token,
            "authorize": user.authorize,
            "user_id": user.user_id,
            "expires_at": user.expires_at
        }
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print("[Cync] Sesión guardada localmente en cync_session.json")
    except Exception as e:
        print(f"[Cync] Error saving session: {e}")

async def authenticate_cync(session: ClientSession):
    saved_user = load_saved_session()
    if saved_user:
        print("[Cync] Usando sesión guardada previa...")
        auth = Auth(session, user=saved_user)
        try:
            cync = await Cync.create(auth)
            print("[Cync] Autenticado exitosamente con sesión guardada!")
            return cync
        except Exception as e:
            print(f"[Cync] Sesión guardada expirada ({e}), re-iniciando login...")

    print("\n" + "=" * 55)
    print("        INICIO DE SESIÓN CYNC (GE LIGHTING)        ")
    print("=" * 55)
    email = input("Ingresa tu correo de la app Cync: ").strip()
    pwd = input("Ingresa tu contraseña de Cync: ").strip()

    auth = Auth(session, username=email, password=pwd)

    try:
        user = await auth.login()
        save_session(user)
    except TwoFactorRequiredError:
        print("\n[Cync] Se requiere verificación en dos pasos (2FA).")
        print(f"[Cync] Código enviado a: {email}")
        code = input("Ingresa el código 2FA más reciente: ").strip()
        try:
            user = await auth.login(two_factor_code=code)
            save_session(user)
        except (AuthFailedError, BadRequestError) as err:
            print(f"\n[Cync Error] Falló la verificación: {err}")
            raise

    cync = await Cync.create(auth)
    print("[Cync] ¡Conexión con Cync completada exitosamente!")
    return cync

def cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }

async def handle_options(request):
    return web.Response(status=204, headers=cors_headers())

async def handle_status(request):
    lights_info = []
    for l in app_state["lights"]:
        lights_info.append({
            "name": l.name,
            "id": l.mesh_reference_id,
            "is_on": l.is_on,
            "rgb": l.rgb
        })
    return web.json_response({
        "status": "online",
        "lights": lights_info,
        "last_rgb": app_state["last_rgb"]
    }, headers=cors_headers())

async def handle_color(request):
    try:
        data = await request.json()
        r = int(data.get("r", 255))
        g = int(data.get("g", 255))
        b = int(data.get("b", 255))
        brightness = data.get("brightness", 100)

        # Optimizar brillo y saturación para iluminación ambiental
        max_c = max(r, g, b)
        if max_c > 0 and max_c < 180:
            scale = min(255 / max_c, 200 / max_c)
            r = min(255, int(r * scale))
            g = min(255, int(g * scale))
            b = min(255, int(b * scale))

        rgb = (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
        app_state["last_rgb"] = rgb

        lights = app_state["lights"]
        if not lights:
            return web.json_response({"error": "No lights found"}, status=404, headers=cors_headers())

        # Filtrar exclusivamente para la luz del cuarto
        target_name = data.get("light")
        if target_name:
            target_lights = [l for l in lights if target_name.lower() in l.name.lower()]
        else:
            target_lights = [l for l in lights if "cuarto" in l.name.lower()] or [lights[0]]

        tasks = []
        for light in target_lights:
            async def update_light(l=light):
                try:
                    if not l.is_on:
                        await l.turn_on()
                    if brightness is not None:
                        await l.set_brightness(int(brightness))
                    await l.set_rgb(rgb)
                except Exception as err:
                    print(f"[Cync] Error actualizando luz '{l.name}': {err}")

            tasks.append(update_light())

        await asyncio.gather(*tasks)
        names = ", ".join(l.name for l in target_lights)
        print(f"[Cync Sync] '{names}' -> RGB{rgb} (brillo {brightness}%)")
        return web.json_response({"success": True, "rgb": rgb, "lights": names}, headers=cors_headers())
    except Exception as e:
        print(f"[Cync] Error en endpoint /color: {e}")
        return web.json_response({"error": str(e)}, status=500, headers=cors_headers())

async def main():
    async with ClientSession() as session:
        cync = await authenticate_cync(session)
        app_state["cync"] = cync

        # Encontrar todas las luces
        all_devices = cync.get_devices()
        lights = [d for d in all_devices if isinstance(d, CyncLight)]
        app_state["lights"] = lights

        print(f"\n[Cync] Dispositivos encontrados: {len(all_devices)}")
        print(f"[Cync] Luces compatibles encontradas: {len(lights)}")
        for l in lights:
            is_target = "cuarto" in l.name.lower()
            tag = " [SINCRONIZADA]" if is_target else " [IGNORADA]"
            print(f"  💡 {l.name} (ID: {l.mesh_reference_id}){tag}")

        app = web.Application()
        app.router.add_options("/color", handle_options)
        app.router.add_post("/color", handle_color)
        app.router.add_options("/status", handle_options)
        app.router.add_get("/status", handle_status)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", PORT)
        await site.start()

        print("\n" + "=" * 55)
        print(f"  SERVIDOR PUENTE CYNC ACTIVO EN PUERTO {PORT}  ")
        print(f"  - Local:    http://localhost:{PORT}")
        print(f"  - Tu red:   http://192.168.1.17:{PORT}")
        print(f"  - Objetivo: Solo 'Luz de cuarto'")
        print("=" * 55 + "\n")
        print("Listo. Ahora al cambiar canciones en SpotiEcho cambiará tu cuarto automáticamente!\n")

        # Keep alive
        while True:
            await asyncio.sleep(3600)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Cync] Servidor puente detenido.")
