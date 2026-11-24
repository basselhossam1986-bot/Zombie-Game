
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const $ = id => document.getElementById(id);

const healthUI = $("health");
const ammoUI = $("ammo");
const scoreUI = $("score");
const waveUI = $("wave");
const messageUI = $("message");

let W, H;
let camera = { x: 0, y: 0 };

const WORLD = { width: 2400, height: 1800 };

let player, zombies, bullets, particles, pickups, obstacles;
let score = 0;
let wave = 1;
let ammo = 30;
let reserveAmmo = 120;
let maxAmmo = 30;
let spawnCount = 0;
let spawnTimer = 0;
let waveDelay = 0;
let gameState = "menu";
let soundEnabled = true;
let mouse = { x: 0, y: 0, down: false };
let keys = {};
let lastTime = 0;
let audio = null;

function resize() {
  W = canvas.width = window.innerWidth * devicePixelRatio;
  H = canvas.height = window.innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  W = window.innerWidth;
  H = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

// ---------- AUDIO ----------
function initAudio() {
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audio.state === "suspended") audio.resume();
}

function tone(freq, duration, type = "sine", volume = .04, endFreq = null) {
  if (!soundEnabled) return;
  initAudio();

  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.currentTime);

  if (endFreq) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, endFreq), audio.currentTime + duration
    );
  }

  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    .001, audio.currentTime + duration
  );

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duration);
}

function noiseSound(duration = .1, volume = .04) {
  if (!soundEnabled) return;
  initAudio();

  const length = Math.floor(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }

  const source = audio.createBufferSource();
  const gain = audio.createGain();

  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(audio.destination);
  source.start();
}

function playSound(type) {
  if (type === "shoot") {
    noiseSound(.09, .07);
    tone(120, .1, "sawtooth", .035, 45);
  }

  if (type === "reload") {
    tone(350, .08, "square", .025, 220);
    setTimeout(() => tone(500, .08, "square", .02, 300), 160);
  }

  if (type === "hit") tone(90, .13, "triangle", .06, 40);
  if (type === "kill") tone(220, .13, "sine", .04, 500);
  if (type === "pickup") tone(450, .2, "sine", .04, 850);
  if (type === "wave") tone(180, .6, "sawtooth", .035, 650);
  if (type === "damage") tone(100, .3, "sawtooth", .05, 35);
  if (type === "gameover") tone(200, .8, "triangle", .05, 35);
}

// ---------- WORLD ----------
function createWorld() {
  obstacles = [];

  for (let i = 0; i < 45; i++) {
    const x = 100 + Math.random() * (WORLD.width - 200);
    const y = 100 + Math.random() * (WORLD.height - 200);

    if (Math.hypot(x - WORLD.width / 2, y - WORLD.height / 2) < 230) {
      continue;
    }

    obstacles.push({
      x, y,
      w: 45 + Math.random() * 100,
      h: 45 + Math.random() * 100
    });
  }
}

function circleRectCollision(x, y, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));

  return Math.hypot(x - closestX, y - closestY) < radius;
}

function blocked(x, y, radius) {
  return obstacles.some(o => circleRectCollision(x, y, radius, o));
}

// ---------- GAME START ----------
function startGame() {
  initAudio();

  player = {
    x: WORLD.width / 2,
    y: WORLD.height / 2,
    radius: 17,
    speed: 230,
    health: 100,
    angle: 0,
    fireCooldown: 0,
    reloadTimer: 0,
    invulnerable: 0
  };

  zombies = [];
  bullets = [];
  particles = [];
  pickups = [];

  score = 0;
  wave = 1;
  ammo = maxAmmo;
  reserveAmmo = 120;
  spawnCount = 0;
  spawnTimer = 1;
  waveDelay = 0;

  createWorld();
  gameState = "playing";

  $("menu").classList.add("hidden");
  $("pauseScreen").classList.add("hidden");
  $("gameOver").classList.add("hidden");

  updateUI();
}

function pauseGame() {
  if (gameState !== "playing") return;
  gameState = "paused";
  $("pauseScreen").classList.remove("hidden");
}

function resumeGame() {
  if (gameState !== "paused") return;
  gameState = "playing";
  $("pauseScreen").classList.add("hidden");
  lastTime = performance.now();
}

function endGame() {
  gameState = "over";
  $("finalScore").textContent = score;
  $("gameOver").classList.remove("hidden");
  playSound("gameover");
}

function goMenu() {
  gameState = "menu";
  $("menu").classList.remove("hidden");
  $("pauseScreen").classList.add("hidden");
  $("gameOver").classList.add("hidden");
}

// ---------- ZOMBIES ----------
function spawnZombie() {
  const side = Math.floor(Math.random() * 4);
  let x, y;

  if (side === 0) { x = camera.x - 80; y = camera.y + Math.random() * H; }
  if (side === 1) { x = camera.x + W + 80; y = camera.y + Math.random() * H; }
  if (side === 2) { x = camera.x + Math.random() * W; y = camera.y - 80; }
  if (side === 3) { x = camera.x + Math.random() * W; y = camera.y + H + 80; }

  x = Math.max(30, Math.min(WORLD.width - 30, x));
  y = Math.max(30, Math.min(WORLD.height - 30, y));

  const roll = Math.random();
  let type = "normal";

  if (wave >= 2 && roll > .78) type = "runner";
  if (wave >= 3 && roll > .90) type = "tank";
  if (wave >= 5 && roll > .95) type = "brute";

  const data = {
    normal: { health: 55, speed: 65, radius: 17, color: "#668b53" },
    runner: { health: 35, speed: 125, radius: 14, color: "#9aab5b" },
    tank: { health: 150, speed: 37, radius: 23, color: "#657d68" },
    brute: { health: 230, speed: 52, radius: 27, color: "#9b493c" }
  }[type];

  zombies.push({
    x, y,
    ...data,
    maxHealth: data.health,
    type,
    angle: 0,
    attackCooldown: 0,
    wobble: Math.random() * 10,
    hitFlash: 0
  });
}

// ---------- PLAYER ----------
function movePlayer(dt) {
  let dx = 0, dy = 0;

  if (keys["w"] || keys["ArrowUp"]) dy--;
  if (keys["s"] || keys["ArrowDown"]) dy++;
  if (keys["a"] || keys["ArrowLeft"]) dx--;
  if (keys["d"] || keys["ArrowRight"]) dx++;

  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;

  const nx = player.x + dx * player.speed * dt;
  const ny = player.y + dy * player.speed * dt;

  if (!blocked(nx, player.y, player.radius)) player.x = nx;
  if (!blocked(player.x, ny, player.radius)) player.y = ny;

  player.x = Math.max(20, Math.min(WORLD.width - 20, player.x));
  player.y = Math.max(20, Math.min(WORLD.height - 20, player.y));

  player.angle = Math.atan2(
    mouse.y + camera.y - player.y,
    mouse.x + camera.x - player.x
  );

  player.fireCooldown -= dt;
  player.invulnerable -= dt;
}

function shoot() {
  if (gameState !== "playing") return;
  if (player.fireCooldown > 0 || player.reloadTimer > 0) return;

  if (ammo <= 0) {
    reload();
    return;
  }

  ammo--;
  player.fireCooldown = .18;

  const angle = player.angle;
  const speed = 780;

  bullets.push({
    x: player.x + Math.cos(angle) * 23,
    y: player.y + Math.sin(angle) * 23,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 1.1,
    damage: 35
  });

  playSound("shoot");
  updateUI();
}

function reload() {
  if (gameState !== "playing") return;
  if (player.reloadTimer > 0 || ammo === maxAmmo || reserveAmmo <= 0) return;

  player.reloadTimer = 1.3;
  playSound("reload");

  setTimeout(() => {
    if (gameState !== "playing" || !player) return;

    const needed = maxAmmo - ammo;
    const amount = Math.min(needed, reserveAmmo);

    ammo += amount;
    reserveAmmo -= amount;
    updateUI();
  }, 1300);
}

// ---------- BULLETS ----------
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    let removed = false;

    if (blocked(b.x, b.y, 3)) {
      bullets.splice(i, 1);
      continue;
    }

    for (const z of zombies) {
      if (Math.hypot(b.x - z.x, b.y - z.y) < z.radius + 4) {
        z.health -= b.damage;
        z.hitFlash = .12;

        createParticles(b.x, b.y, "#e7d7a4", 5);
        bullets.splice(i, 1);
        removed = true;

        if (z.health <= 0) {
          score += z.type === "brute" ? 40 : z.type === "tank" ? 25 : 10;
          createParticles(z.x, z.y, z.color, 15);
          playSound("kill");

          if (Math.random() < .18) {
            pickups.push({
              x: z.x,
              y: z.y,
              type: Math.random() < .5 ? "health" : "ammo",
              life: 15
            });
          }
        } else {
          playSound("hit");
        }

        break;
      }
    }

    if (!removed && b.life <= 0) bullets.splice(i, 1);
  }

  zombies = zombies.filter(z => z.health > 0);
}

// ---------- ZOMBIE MOVEMENT ----------
function updateZombies(dt) {
  for (const z of zombies) {
    const dx = player.x - z.x;
    const dy = player.y - z.y;
    const distance = Math.hypot(dx, dy) || 1;

    z.angle = Math.atan2(dy, dx);
    z.wobble += dt * 8;
    z.hitFlash -= dt;
    z.attackCooldown -= dt;

    if (distance > z.radius + player.radius + 5) {
      const vx = dx / distance * z.speed * dt;
      const vy = dy / distance * z.speed * dt;

      const nx = z.x + vx;
      const ny = z.y + vy;

      if (!blocked(nx, z.y, z.radius)) z.x = nx;
      if (!blocked(z.x, ny, z.radius)) z.y = ny;
    } else if (z.attackCooldown <= 0) {
      if (player.invulnerable <= 0) {
        player.health -= z.type === "brute" ? 18 : 10;
        player.invulnerable = .65;
        playSound("damage");
      }

      z.attackCooldown = .8;
    }
  }
}

// ---------- PICKUPS ----------
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.life -= dt;

    if (Math.hypot(player.x - p.x, player.y - p.y) < 30) {
      if (p.type === "health") {
        player.health = Math.min(100, player.health + 25);
      } else {
        reserveAmmo += 30;
      }

      playSound("pickup");
      pickups.splice(i, 1);
    } else if (p.life <= 0) {
      pickups.splice(i, 1);
    }
  }
}

// ---------- PARTICLES ----------
function createParticles(x, y, color, amount) {
  for (let i = 0; i < amount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 160;

    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: .25 + Math.random() * .45,
      maxLife: .7,
      color,
      size: 2 + Math.random() * 3
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ---------- WAVES ----------
function updateWaves(dt) {
  if (spawnCount < wave * 5 + 5) {
    spawnTimer -= dt;

    if (spawnTimer <= 0) {
      spawnZombie();
      spawnCount++;
      spawnTimer = Math.max(.35, 1.3 - wave * .04);
    }
  } else if (zombies.length === 0) {
    waveDelay += dt;

    if (waveDelay >= 3) {
      wave++;
      spawnCount = 0;
      waveDelay = 0;
      spawnTimer = 1.2;
      player.health = Math.min(100, player.health + 10);
      reserveAmmo += 15;
      playSound("wave");

      messageUI.textContent = "WAVE " + wave;
      setTimeout(() => messageUI.textContent = "", 1500);
    }
  }
}

// ---------- DRAW WORLD ----------
function drawWorld() {
  ctx.fillStyle = "#202a25";
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  ctx.strokeStyle = "rgba(160,190,160,.07)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= WORLD.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.height);
    ctx.stroke();
  }

  for (let y = 0; y <= WORLD.height; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
    ctx.stroke();
  }

  for (const o of obstacles) {
    ctx.fillStyle = "#303a35";
    ctx.fillRect(o.x, o.y, o.w, o.h);

    ctx.strokeStyle = "#59645b";
    ctx.strokeRect(o.x, o.y, o.w, o.h);

    ctx.fillStyle = "#202824";
    ctx.fillRect(o.x + 7, o.y + 7, o.w - 14, o.h - 14);
  }
}

// ---------- DRAW CHARACTER ----------
function drawPlayer() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.ellipse(0, 7, 19, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = "#343d38";
  ctx.fillRect(-12, -10, 11, 21);
  ctx.fillRect(4, -10, 11, 21);

  // Boots
  ctx.fillStyle = "#171b19";
  ctx.fillRect(-13, -12, 13, 7);
  ctx.fillRect(4, 5, 13, 7);

  // Body
  ctx.fillStyle = "#536d5a";
  ctx.fillRect(-13, -13, 26, 26);

  // Armor
  ctx.fillStyle = "#263c32";
  ctx.fillRect(-7, -10, 14, 20);

  // Arms
  ctx.fillStyle = "#bd9673";
  ctx.fillRect(-10, -18, 10, 8);
  ctx.fillRect(-10, 10, 10, 8);

  // Head
  ctx.fillStyle = "#d2a17b";
  ctx.beginPath();
  ctx.arc(3, 0, 10, 0, Math.PI * 2);
  ctx.fill();

  // Helmet
  ctx.fillStyle = "#344c3b";
  ctx.beginPath();
  ctx.arc(3, 0, 10, -Math.PI / 2, Math.PI / 2);
  ctx.fill();

  // Gun
  ctx.fillStyle = "#171a19";
  ctx.fillRect(8, -4, 25, 8);
  ctx.fillStyle = "#87918b";
  ctx.fillRect(25, -2, 12, 4);

  ctx.restore();

  if (player.invulnerable > 0) {
    ctx.strokeStyle = "rgba(255,255,255,.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ---------- DRAW ZOMBIE ----------
function drawZombie(z) {
  ctx.save();
  ctx.translate(z.x, z.y);
  ctx.rotate(z.angle);

  const bob = Math.sin(z.wobble) * 2;
  const scale = z.type === "brute" ? 1.25 : z.type === "tank" ? 1.15 : 1;

  ctx.scale(scale, scale);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,.4)";
  ctx.beginPath();
  ctx.ellipse(0, 8, 22, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = "#393b31";
  ctx.fillRect(-13, -10 + bob, 12, 19);
  ctx.fillRect(4, -9 - bob, 12, 19);

  // Feet
  ctx.fillStyle = "#20251f";
  ctx.fillRect(-15, -13 + bob, 14, 7);
  ctx.fillRect(3, 7 - bob, 14, 7);

  // Arms
  ctx.strokeStyle = z.color;
  ctx.lineWidth = 9;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(-2, -11);
  ctx.lineTo(9, -20 + bob);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-2, 11);
  ctx.lineTo(9, 20 - bob);
  ctx.stroke();

  // Hands
  ctx.fillStyle = "#8da66c";
  ctx.beginPath();
  ctx.arc(10, -20 + bob, 5, 0, Math.PI * 2);
  ctx.arc(10, 20 - bob, 5, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = z.hitFlash > 0 ? "#f2d8bd" : z.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // Torn clothes
  ctx.fillStyle = "#343d34";
  ctx.fillRect(-8, -7, 11, 14);
  ctx.fillStyle = "#a1a08a";
  ctx.fillRect(-7, -4, 3, 5);

  // Neck
  ctx.fillStyle = "#819768";
  ctx.fillRect(8, -5, 6, 10);

  // Head
  ctx.fillStyle = z.hitFlash > 0 ? "#f0d6bc" : "#8da66c";
  ctx.beginPath();
  ctx.ellipse(14, 0, 9, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = "#34372c";
  ctx.beginPath();
  ctx.arc(13, -2, 9, Math.PI, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = "#d52b24";
  ctx.beginPath();
  ctx.arc(17, -4, 2, 0, Math.PI * 2);
  ctx.arc(17, 4, 2, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  ctx.strokeStyle = "#3c211e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, -3);
  ctx.lineTo(23, 0);
  ctx.lineTo(20, 3);
  ctx.stroke();

  ctx.restore();

  // Health bar
  const barWidth = z.radius * 2.2;
  ctx.fillStyle = "#261e1d";
  ctx.fillRect(z.x - barWidth / 2, z.y - z.radius - 12, barWidth, 4);

  ctx.fillStyle = "#e54c3e";
  ctx.fillRect(
    z.x - barWidth / 2,
    z.y - z.radius - 12,
    barWidth * Math.max(0, z.health / z.maxHealth),
    4
  );
}

// ---------- DRAW OBJECTS ----------
function drawBullets() {
  for (const b of bullets) {
    ctx.fillStyle = "#ffe6a3";
    ctx.shadowColor = "#ffca58";
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
  }
}

function drawPickups() {
  for (const p of pickups) {
    ctx.fillStyle = p.type === "health" ? "#3dbb73" : "#e7c34d";
    ctx.fillRect(p.x - 10, p.y - 10, 20, 20);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 15px Arial";
    ctx.textAlign = "center";
    ctx.fillText(p.type === "health" ? "+" : "A", p.x, p.y + 5);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }

  ctx.globalAlpha = 1;
}

// ---------- LIGHTING ----------
function drawLighting() {
  const gradient = ctx.createRadialGradient(
    player.x, player.y, 60,
    player.x, player.y, 420
  );

  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(.65, "rgba(0,0,0,.25)");
  gradient.addColorStop(1, "rgba(0,0,0,.78)");

  ctx.fillStyle = gradient;
  ctx.fillRect(camera.x, camera.y, W, H);
}

// ---------- CAMERA ----------
function updateCamera() {
  camera.x = player.x - W / 2;
  camera.y = player.y - H / 2;

  camera.x = Math.max(0, Math.min(WORLD.width - W, camera.x));
  camera.y = Math.max(0, Math.min(WORLD.height - H, camera.y));
}

// ---------- UI ----------
function updateUI() {
  healthUI.textContent = Math.max(0, Math.ceil(player.health));
  ammoUI.textContent = ammo + " / " + reserveAmmo;
  scoreUI.textContent = score;
  waveUI.textContent = wave;
}

// ---------- UPDATE ----------
function update(dt) {
  if (gameState !== "playing") return;

  movePlayer(dt);

  if (mouse.down) shoot();

  updateBullets(dt);
  updateZombies(dt);
  updatePickups(dt);
  updateParticles(dt);
  updateWaves(dt);

  if (player.health <= 0) {
    player.health = 0;
    updateUI();
    endGame();
  }

  updateCamera();
  updateUI();
}

// ---------- RENDER ----------
function render() {
  ctx.clearRect(0, 0, W, H);

  if (!player) {
    ctx.fillStyle = "#18211d";
    ctx.fillRect(0, 0, W, H);
    return;
  }

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  drawWorld();
  drawPickups();
  drawBullets();

  for (const z of zombies) drawZombie(z);

  drawPlayer();
  drawParticles();
  drawLighting();

  ctx.restore();
}

// ---------- MAIN LOOP ----------
function loop(time) {
  const dt = Math.min((time - lastTime) / 1000 || 0, .04);
  lastTime = time;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

// ---------- CONTROLS ----------
window.addEventListener("keydown", e => {
  keys[e.key] = true;

  if (e.key.toLowerCase() === "r") reload();

  if (e.key === "Escape") {
    if (gameState === "playing") pauseGame();
    else if (gameState === "paused") resumeGame();
  }
});

window.addEventListener("keyup", e => {
  keys[e.key] = false;
});

canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
});

canvas.addEventListener("mousedown", e => {
  if (e.button === 0) mouse.down = true;
});

window.addEventListener("mouseup", () => {
  mouse.down = false;
});

canvas.addEventListener("contextmenu", e => e.preventDefault());

// ---------- BUTTONS ----------
$("startBtn").addEventListener("click", startGame);
$("restartBtn").addEventListener("click", startGame);
$("resumeBtn").addEventListener("click", resumeGame);
$("pauseBtn").addEventListener("click", pauseGame);
$("menuBtn").addEventListener("click", goMenu);
$("homeBtn").addEventListener("click", goMenu);

$("soundBtn").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  $("soundBtn").textContent = soundEnabled ? "🔊" : "🔇";
});

// ---------- START ----------
requestAnimationFrame(loop);
