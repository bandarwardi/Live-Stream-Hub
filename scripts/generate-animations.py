import os
import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

SRC_DIR = r"f:\apps\customers\Live-Stream-Hub\admin\public\assets\store"
OUT_DIR = os.path.join(SRC_DIR, "animations")
APP_OUT_DIR = r"f:\apps\customers\Live-Stream-Hub\app\artifacts\streamzone\assets\images\store\animations"

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(APP_OUT_DIR, exist_ok=True)

NUM_FRAMES = 24
FRAME_DURATION = 42 # ~24 fps (1000ms loop)

def create_supercar_animation():
    src_path = os.path.join(SRC_DIR, "entry_supercar.png")
    car_base = Image.open(src_path).convert("RGBA")
    w, h = 320, 256
    frames = []

    for i in range(NUM_FRAMES):
        t = i / NUM_FRAMES
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(frame)

        # Micro vibration
        vibe_y = math.sin(t * math.pi * 8) * 1.5
        vibe_x = math.cos(t * math.pi * 4) * 0.8

        car_x = int(50 + vibe_x)
        car_y = int(50 + vibe_y)

        # 1. Underglow (pulsing cyan / magenta)
        underglow_alpha = int(120 + 70 * math.sin(t * math.pi * 4))
        ug_color = (0, 240, 255, underglow_alpha) if (i % 6 < 3) else (255, 0, 200, underglow_alpha)
        underglow_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ug_draw = ImageDraw.Draw(underglow_img)
        ug_draw.ellipse([car_x + 30, car_y + 130, car_x + 220, car_y + 165], fill=ug_color)
        underglow_img = underglow_img.filter(ImageFilter.GaussianBlur(12))
        frame = Image.alpha_composite(frame, underglow_img)

        # 2. Speed streak particles behind car
        streak_draw = ImageDraw.Draw(frame)
        for s in range(6):
            sx = (int((s * 55 - t * 240)) % 140) + car_x - 70
            sy = car_y + 60 + (s * 15) % 80
            slen = 25 + (s * 7) % 20
            salpha = int(100 + 100 * math.sin((t + s * 0.2) * math.pi * 2))
            streak_draw.line([sx - slen, sy, sx, sy], fill=(255, 255, 255, salpha), width=2)

        # 3. Exhaust nitro flame bursts (at rear, approx car_x + 20, car_y + 115)
        flame_len = 25 + 18 * math.sin(t * math.pi * 12) + random.uniform(-4, 4)
        fx = car_x + 15
        fy = car_y + 115
        flame_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        flame_draw = ImageDraw.Draw(flame_img)
        # Outer blue/orange glow
        flame_draw.polygon([
            (fx, fy - 6), (fx - flame_len, fy), (fx, fy + 6)
        ], fill=(255, 120, 20, 200))
        # Inner white/cyan core
        flame_draw.polygon([
            (fx, fy - 3), (fx - flame_len * 0.65, fy), (fx, fy + 3)
        ], fill=(0, 240, 255, 240))
        flame_img = flame_img.filter(ImageFilter.GaussianBlur(3))
        frame = Image.alpha_composite(frame, flame_img)

        # 4. Paste Car
        frame.alpha_composite(car_base, (car_x, car_y))

        # 5. Headlight beam sweep (pointing front right)
        hl_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        hl_draw = ImageDraw.Draw(hl_img)
        hl_x = car_x + 220
        hl_y = car_y + 115
        hl_pulse = 0.8 + 0.2 * math.sin(t * math.pi * 6)
        beam_len = 65 * hl_pulse
        hl_draw.polygon([
            (hl_x, hl_y),
            (hl_x + beam_len, hl_y - 20),
            (hl_x + beam_len, hl_y + 35)
        ], fill=(255, 255, 220, int(90 * hl_pulse)))
        hl_img = hl_img.filter(ImageFilter.GaussianBlur(8))
        frame = Image.alpha_composite(frame, hl_img)

        # Headlight lens flare star
        flare_draw = ImageDraw.Draw(frame)
        flare_alpha = int(180 + 70 * math.sin(t * math.pi * 8))
        flare_size = int(6 + 3 * math.sin(t * math.pi * 6))
        flare_draw.ellipse([hl_x - flare_size, hl_y - flare_size, hl_x + flare_size, hl_y + flare_size], fill=(255, 255, 255, flare_alpha))

        frames.append(frame)

    return frames

def create_rocket_animation():
    src_path = os.path.join(SRC_DIR, "entry_rocket.png")
    rocket_base = Image.open(src_path).convert("RGBA")
    w, h = 256, 300
    frames = []

    for i in range(NUM_FRAMES):
        t = i / NUM_FRAMES
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))

        # Hover float
        hover_y = math.sin(t * math.pi * 2) * 5
        rx = 15
        ry = int(15 + hover_y)

        # Rocket nozzle flame plume (bottom center approx rx + 115, ry + 215)
        plume_x = rx + 115
        plume_y = ry + 215
        plume_len = 45 + 18 * math.sin(t * math.pi * 8) + random.uniform(-3, 3)

        flame_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        f_draw = ImageDraw.Draw(flame_img)
        # Outer red/orange plume
        f_draw.polygon([
            (plume_x - 22, plume_y),
            (plume_x, plume_y + plume_len),
            (plume_x + 22, plume_y)
        ], fill=(255, 60, 0, 220))
        # Mid yellow plume
        f_draw.polygon([
            (plume_x - 14, plume_y),
            (plume_x, plume_y + plume_len * 0.75),
            (plume_x + 14, plume_y)
        ], fill=(255, 220, 0, 240))
        # Inner white-hot core
        f_draw.polygon([
            (plume_x - 7, plume_y),
            (plume_x, plume_y + plume_len * 0.5),
            (plume_x + 7, plume_y)
        ], fill=(255, 255, 255, 255))
        flame_img = flame_img.filter(ImageFilter.GaussianBlur(4))
        frame = Image.alpha_composite(frame, flame_img)

        # Ejected glowing plasma ember sparks falling down
        spark_draw = ImageDraw.Draw(frame)
        for s in range(10):
            sp_t = (t + s * 0.1) % 1.0
            sp_x = plume_x + math.sin(s * 1.7 + t * 4) * (15 + sp_t * 20)
            sp_y = plume_y + sp_t * 65
            sp_size = max(1, int(3 * (1 - sp_t)))
            sp_alpha = int(220 * (1 - sp_t))
            spark_draw.ellipse([sp_x - sp_size, sp_y - sp_size, sp_x + sp_size, sp_y + sp_size], fill=(255, 200, 50, sp_alpha))

        # Cosmic hull glow
        hull_glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        hg_draw = ImageDraw.Draw(hull_glow)
        hg_pulse = int(50 + 35 * math.sin(t * math.pi * 2))
        hg_draw.ellipse([rx + 60, ry + 30, rx + 170, ry + 180], fill=(120, 160, 255, hg_pulse))
        hull_glow = hull_glow.filter(ImageFilter.GaussianBlur(15))
        frame = Image.alpha_composite(frame, hull_glow)

        # Paste Rocket
        frame.alpha_composite(rocket_base, (rx, ry))

        frames.append(frame)

    return frames

def create_jet_animation():
    src_path = os.path.join(SRC_DIR, "entry_jet.png")
    jet_base = Image.open(src_path).convert("RGBA")
    w, h = 320, 256
    frames = []

    for i in range(NUM_FRAMES):
        t = i / NUM_FRAMES
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))

        # Flight micro-bank
        tilt_y = math.sin(t * math.pi * 2) * 3
        jx = 35
        jy = int(25 + tilt_y)

        # Supersonic afterburner twin flames at jet engines (rear left: jx+35, jy+110 and jy+130 approx)
        engine_y1 = jy + 105
        engine_y2 = jy + 125
        engine_x = jx + 30

        flame_len = 35 + 15 * math.sin(t * math.pi * 10) + random.uniform(-2, 2)
        flame_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        f_draw = ImageDraw.Draw(flame_img)

        for ey in [engine_y1, engine_y2]:
            # Electric cyan supersonic afterburner cone
            f_draw.polygon([
                (engine_x, ey - 5),
                (engine_x - flame_len, ey),
                (engine_x, ey + 5)
            ], fill=(0, 210, 255, 230))
            # Mach diamond shock rings
            for m in range(3):
                mx = engine_x - (m + 1) * (flame_len * 0.28)
                f_draw.ellipse([mx - 3, ey - 3, mx + 3, ey + 3], fill=(255, 255, 255, 240))
        flame_img = flame_img.filter(ImageFilter.GaussianBlur(3))
        frame = Image.alpha_composite(frame, flame_img)

        # Shockwave sonic boom rings expanding backwards
        shock_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        s_draw = ImageDraw.Draw(shock_img)
        for ring in range(2):
            ring_phase = (t + ring * 0.5) % 1.0
            ring_r = 20 + ring_phase * 60
            ring_alpha = int(150 * (1 - ring_phase))
            ring_x = jx + 100 - ring_phase * 70
            s_draw.ellipse([ring_x - ring_r * 0.4, jy + 115 - ring_r, ring_x + ring_r * 0.4, jy + 115 + ring_r], outline=(150, 220, 255, ring_alpha), width=2)
        shock_img = shock_img.filter(ImageFilter.GaussianBlur(2))
        frame = Image.alpha_composite(frame, shock_img)

        # Paste Jet
        frame.alpha_composite(jet_base, (jx, jy))

        frames.append(frame)

    return frames

def create_dragon_animation():
    src_path = os.path.join(SRC_DIR, "entry_dragon.png")
    dragon_base = Image.open(src_path).convert("RGBA")
    w, h = 280, 280
    frames = []

    for i in range(NUM_FRAMES):
        t = i / NUM_FRAMES
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))

        # Majestic undulating hover
        hover_y = math.sin(t * math.pi * 2) * 6
        hover_x = math.cos(t * math.pi * 2) * 3
        dx = int(12 + hover_x)
        dy = int(12 + hover_y)

        # Radiant Golden Celestial Aura (multi-layered pulsing halo)
        aura_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        a_draw = ImageDraw.Draw(aura_img)
        pulse = 0.85 + 0.25 * math.sin(t * math.pi * 3)
        aura_alpha = int(100 * pulse)
        a_draw.ellipse([dx + 20, dy + 20, dx + 236, dy + 236], fill=(255, 200, 40, aura_alpha))
        aura_img = aura_img.filter(ImageFilter.GaussianBlur(20))
        frame = Image.alpha_composite(frame, aura_img)

        # Floating gold magic sparkles / stardust
        sparkle_draw = ImageDraw.Draw(frame)
        for s in range(12):
            sp_phase = (t + s * (1 / 12)) % 1.0
            angle = s * (math.pi * 2 / 12) + t * 2
            dist = 90 + math.sin(sp_phase * math.pi * 2) * 30
            sp_x = dx + 128 + math.cos(angle) * dist
            sp_y = dy + 128 + math.sin(angle) * dist
            sp_size = max(1, int(4 * math.sin(sp_phase * math.pi)))
            sp_alpha = int(220 * math.sin(sp_phase * math.pi))
            sparkle_draw.ellipse([sp_x - sp_size, sp_y - sp_size, sp_x + sp_size, sp_y + sp_size], fill=(255, 235, 120, sp_alpha))

        # Paste Dragon
        frame.alpha_composite(dragon_base, (dx, dy))

        # Dragon golden breath ember flare at mouth (approx dx + 210, dy + 70)
        mouth_x = dx + 210
        mouth_y = dy + 70
        breath_phase = math.sin(t * math.pi * 4)
        if breath_phase > 0.2:
            breath_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            b_draw = ImageDraw.Draw(breath_img)
            b_len = 25 * breath_phase
            b_draw.ellipse([mouth_x, mouth_y - 6, mouth_x + b_len, mouth_y + 6], fill=(255, 140, 20, int(200 * breath_phase)))
            b_draw.ellipse([mouth_x, mouth_y - 3, mouth_x + b_len * 0.6, mouth_y + 3], fill=(255, 255, 180, int(240 * breath_phase)))
            breath_img = breath_img.filter(ImageFilter.GaussianBlur(3))
            frame = Image.alpha_composite(frame, breath_img)

        frames.append(frame)

    return frames

def create_comet_animation():
    src_path = os.path.join(SRC_DIR, "entry_comet.png")
    comet_base = Image.open(src_path).convert("RGBA")
    w, h = 320, 256
    frames = []

    for i in range(NUM_FRAMES):
        t = i / NUM_FRAMES
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))

        # Float
        cy = int(15 + math.sin(t * math.pi * 2) * 3)
        cx = int(45 + math.cos(t * math.pi * 2) * 2)

        # Trailing cosmic flame waves (streaming toward upper-left, approx tail origin cx + 80, cy + 90)
        tail_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        t_draw = ImageDraw.Draw(tail_img)
        tail_x = cx + 80
        tail_y = cy + 100

        for layer in range(5):
            wave = math.sin(t * math.pi * 4 + layer) * 12
            tail_len = 80 + layer * 20
            color = [(140, 40, 255, 140), (0, 220, 255, 160), (255, 180, 40, 180)][layer % 3]
            t_draw.line([tail_x, tail_y, tail_x - tail_len, tail_y - 50 + wave], fill=color, width=8 - layer)

        tail_img = tail_img.filter(ImageFilter.GaussianBlur(6))
        frame = Image.alpha_composite(frame, tail_img)

        # Star sparkles shedding from comet tail
        spark_draw = ImageDraw.Draw(frame)
        for s in range(14):
            st = (t + s * (1 / 14)) % 1.0
            sx = tail_x - st * 110 + math.sin(s * 2 + t * 5) * 15
            sy = tail_y - st * 50 + math.cos(s * 3 + t * 5) * 18
            s_alpha = int(240 * (1 - st))
            s_sz = max(1, int(3 * (1 - st)))
            spark_draw.ellipse([sx - s_sz, sy - s_sz, sx + s_sz, sy + s_sz], fill=(255, 255, 255, s_alpha))

        # Paste Comet
        frame.alpha_composite(comet_base, (cx, cy))

        # Blazing core pulsating glare
        glare_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        g_draw = ImageDraw.Draw(glare_img)
        glare_pulse = 0.8 + 0.3 * math.sin(t * math.pi * 6)
        core_x = cx + 180
        core_y = cy + 160
        g_draw.ellipse([core_x - 30 * glare_pulse, core_y - 30 * glare_pulse, core_x + 30 * glare_pulse, core_y + 30 * glare_pulse], fill=(255, 255, 255, int(150 * glare_pulse)))
        glare_img = glare_img.filter(ImageFilter.GaussianBlur(10))
        frame = Image.alpha_composite(frame, glare_img)

        frames.append(frame)

    return frames

def create_helicopter_animation():
    src_path = os.path.join(SRC_DIR, "entry_helicopter.png")
    heli_base = Image.open(src_path).convert("RGBA")
    w, h = 256, 256
    frames = []

    for i in range(NUM_FRAMES):
        t = i / NUM_FRAMES
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))

        # Realistic flight wobble
        hover_y = math.sin(t * math.pi * 2) * 4
        hover_x = math.cos(t * math.pi * 2) * 1.5
        hx = int(hover_x)
        hy = int(hover_y)

        # Spotlight beam projecting downward from belly (approx hx + 110, hy + 175)
        spot_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        s_draw = ImageDraw.Draw(spot_img)
        spot_pulse = 0.85 + 0.15 * math.sin(t * math.pi * 4)
        spot_x = hx + 110
        spot_y = hy + 175
        s_draw.polygon([
            (spot_x, spot_y),
            (spot_x - 45, 255),
            (spot_x + 45, 255)
        ], fill=(220, 245, 255, int(85 * spot_pulse)))
        spot_img = spot_img.filter(ImageFilter.GaussianBlur(8))
        frame = Image.alpha_composite(frame, spot_img)

        # Paste Helicopter
        frame.alpha_composite(heli_base, (hx, hy))

        # Rotor Blur Disc (spinning blades at hx + 128, hy + 50)
        rotor_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        r_draw = ImageDraw.Draw(rotor_img)
        rotor_center = (hx + 128, hy + 48)
        rotor_r = 95
        # Draw motion-blurred rotor disc
        r_draw.ellipse([rotor_center[0] - rotor_r, rotor_center[1] - 8, rotor_center[0] + rotor_r, rotor_center[1] + 8], fill=(240, 240, 255, 60))
        # Draw high-speed rotating blade lines
        for b in range(3):
            b_angle = t * math.pi * 6 + b * (math.pi * 2 / 3)
            bx = rotor_center[0] + math.cos(b_angle) * rotor_r
            by = rotor_center[1] + math.sin(b_angle) * 7
            r_draw.line([rotor_center[0], rotor_center[1], bx, by], fill=(255, 255, 255, 180), width=2)
        rotor_img = rotor_img.filter(ImageFilter.GaussianBlur(1))
        frame = Image.alpha_composite(frame, rotor_img)

        # Flashing aviation beacon light (red top beacon on rotor mast: hx + 128, hy + 38)
        # Standard beacon flash (2 flashes per second)
        is_flash = (i % 6 < 2)
        if is_flash:
            beacon_draw = ImageDraw.Draw(frame)
            beacon_x = hx + 128
            beacon_y = hy + 40
            beacon_draw.ellipse([beacon_x - 6, beacon_y - 6, beacon_x + 6, beacon_y + 6], fill=(255, 20, 20, 240))
            beacon_draw.ellipse([beacon_x - 3, beacon_y - 3, beacon_x + 3, beacon_y + 3], fill=(255, 255, 255, 255))

        frames.append(frame)

    return frames

def save_animation(frames, name):
    # Save as Animated WebP
    webp_path = os.path.join(OUT_DIR, f"{name}.webp")
    app_webp_path = os.path.join(APP_OUT_DIR, f"{name}.webp")
    frames[0].save(
        webp_path,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_DURATION,
        loop=0,
        optimize=True,
        quality=90
    )
    # Save copy to app directory
    frames[0].save(
        app_webp_path,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_DURATION,
        loop=0,
        optimize=True,
        quality=90
    )

    # Save as Animated GIF as well for universal fallback
    gif_path = os.path.join(OUT_DIR, f"{name}.gif")
    app_gif_path = os.path.join(APP_OUT_DIR, f"{name}.gif")
    frames[0].save(
        gif_path,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_DURATION,
        loop=0,
        disposal=2
    )
    frames[0].save(
        app_gif_path,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_DURATION,
        loop=0,
        disposal=2
    )

    size_kb = os.path.getsize(webp_path) / 1024
    print(f"Generated {name}: {size_kb:.1f} KB WebP ({len(frames)} frames)")

if __name__ == "__main__":
    print("Generating entry animations...")
    save_animation(create_supercar_animation(), "entry_supercar")
    save_animation(create_rocket_animation(), "entry_rocket")
    save_animation(create_jet_animation(), "entry_jet")
    save_animation(create_dragon_animation(), "entry_dragon")
    save_animation(create_comet_animation(), "entry_comet")
    save_animation(create_helicopter_animation(), "entry_helicopter")
    print("All animations generated successfully!")
