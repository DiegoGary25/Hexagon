(function(){
  'use strict';
  var root = window.HEX;
  if(!root || !root.math || !root.input || !root.audio){
    throw new Error('HEX subsystems missing');
  }

  var math = root.math;
  var input = root.input;
  var audio = root.audio;
  var doc = document;

  var WIDTH = 480;
  var HEIGHT = 640;
  var CENTER_X = WIDTH / 2;
  var CENTER_Y = HEIGHT / 2;

  /* ========= EDIT HERE: GAME TUNABLES ========= */
  const TUNE = Object.freeze({
    PLAYER_ORBIT_RADIUS_PX: 110,
    PLAYER_SIZE_PX: 12,
    PLAYER_TURN_SPEED_RAD_S: 3.8,
    PLAYER_TURN_ACCEL_RAD_S2: 16.0,

    // Obstacle spacing & pacing
    SPAWN_MIN_INTERVAL_S: 0.42,
    SPAWN_MAX_INTERVAL_S: 0.62,
    DIFFICULTY_SPAWN_ACCEL: 0.985,

    // Arena motion
    ENABLE_ARENA_SPIN: true,
    SPIN_BASE_SPEED_RAD_S: 0.65,
    SPIN_SPEED_JITTER: 0.08,
    SPIN_JITTER_FREQ_HZ: 0.25,
    ENABLE_ARENA_ZOOM: true,
    ZOOM_AMPLITUDE: 0.05,
    ZOOM_FREQ_HZ: 0.45,

    // NEW: obstacle thickness (radial width in pixels, pre-DPR)
    OBSTACLE_THICKNESS_PX: 18,

    PLAYFIELD_PADDING_PX: 56
  });
  /* ========= /TUNABLES ========= */

  var PLAYFIELD_RADIUS = Math.min(WIDTH, HEIGHT) / 2 - TUNE.PLAYFIELD_PADDING_PX;
  var STEP_RATE = 1 / 120;
  var TWO_PI = Math.PI * 2;

  var dpr = window.devicePixelRatio || 1;
  var baseObstacleThickness = 0;
  var obstacleThickness = 0;

  var PALETTE = null;
  var colorIndex = 0;

  function clampObstacleThicknessPx(value){
    return math.clamp(value, 6, 64);
  }

  function refreshObstacleThickness(){
    baseObstacleThickness = clampObstacleThicknessPx(TUNE.OBSTACLE_THICKNESS_PX);
    obstacleThickness = baseObstacleThickness * dpr;
  }

  refreshObstacleThickness();

  function buildPalette(){
    if(PALETTE){ return; }
    var styles = getComputedStyle(document.documentElement);
    var palette = [
      styles.getPropertyValue('--accent1').trim() || '#3DE0B4',
      styles.getPropertyValue('--accent2').trim() || '#7F51FF',
      styles.getPropertyValue('--accent3').trim() || '#FF517A',
      styles.getPropertyValue('--accent4').trim() || '#D1FF51'
    ];
    PALETTE = Object.freeze(palette);
  }

  var container = null;
  var canvas = null;
  var ctx = null;
  var scoreEl = null;
  var banner = null;
  var overlay = null;
  var message = null;
  var playAgain = null;
  var multiplierFill = null;
  var multiplierText = null;
  var multiplierBar = null;

  var state = 'BOOT';
  var isStarting = false;
  var initCalled = false;

  var accumulator = 0;
  var lastTimestamp = 0;
  var globalTime = 0;

  var survivalTime = 0;
  var score = 0;
  var multiplier = 1;
  var multiplierProgress = 0;
  var multiplierPulseTimer = 0;
  var multiplierDropTimer = 0;
  var nextCheckpoint = 20;

  var logicalSides = 6;
  var displaySides = 6;
  var targetSides = 6;
  var previousSides = 6;
  var morphTimer = 0;
  var morphDuration = 0;
  var spawnPauseTimer = 0;
  var gapGuideFade = 1;
  var worldSpinAngle = 0;
  var worldZoom = 1;
  var spinVelocity = 0;
  var spinTimer = 0;
  var nextSpinAt = 12;
  var checksumSalt = 0;
  var checksum = 0;
  var bannerTimer = 0;
  var bannerActive = false;
  var tiltTimer = 0;

  var rings = [];
  var ringPool = [];
  var MAX_RINGS = 80;

  var player = {
    angle: -Math.PI / 2,
    velocity: 0,
    radius: TUNE.PLAYER_ORBIT_RADIUS_PX,
    hitTolerance: TUNE.PLAYER_SIZE_PX * 0.85
  };

  function createRing(){
    return {
      active: false,
      moving: false,
      telegraph: 0,
      telegraphMax: 0,
      radiusOuter: 0,
      radiusInner: 0,
      thickness: 0,
      sides: 0,
      gapIndex: 0,
      gapSpanRatio: 1,
      segAngle: 0,
      baseAngle: -Math.PI / 2,
      spawnSpin: 0,
      speedPxPerS: 0,
      color: '#ffffff',
      altGapIndex: -1,
      flickerTrigger: 0,
      flickerDone: false,
      collapseTrigger: 0,
      collapseWidth: 1,
      guideStrength: 1,
      patternTag: 'base',
      age: 0,
      dead: false
    };
  }

  function getRing(){
    for(var i=0;i<ringPool.length;i++){
      if(!ringPool[i].active){
        ringPool[i].active = true;
        rings.push(ringPool[i]);
        return ringPool[i];
      }
    }
    if(ringPool.length < MAX_RINGS){
      var ring = createRing();
      ring.active = true;
      ringPool.push(ring);
      rings.push(ring);
      return ring;
    }
    return null;
  }

  function releaseRing(ring){
    ring.active = false;
    ring.moving = false;
    ring.telegraph = 0;
    ring.telegraphMax = 0;
    ring.radiusOuter = 0;
    ring.radiusInner = 0;
    ring.thickness = 0;
    ring.sides = 0;
    ring.gapIndex = 0;
    ring.gapSpanRatio = 1;
    ring.segAngle = 0;
    ring.baseAngle = -Math.PI / 2;
    ring.spawnSpin = 0;
    ring.speedPxPerS = 0;
    ring.color = '#ffffff';
    ring.altGapIndex = -1;
    ring.flickerTrigger = 0;
    ring.flickerDone = false;
    ring.collapseTrigger = 0;
    ring.collapseWidth = 1;
    ring.guideStrength = 0;
    ring.patternTag = 'base';
    ring.age = 0;
    ring.dead = false;
  }

  function clearRings(){
    rings.length = 0;
    for(var i=0;i<ringPool.length;i++){
      ringPool[i].active = false;
      ringPool[i].moving = false;
      ringPool[i].telegraph = 0;
      ringPool[i].telegraphMax = 0;
      ringPool[i].radiusOuter = 0;
      ringPool[i].radiusInner = 0;
      ringPool[i].thickness = 0;
      ringPool[i].sides = 0;
      ringPool[i].gapIndex = 0;
      ringPool[i].gapSpanRatio = 1;
      ringPool[i].segAngle = 0;
      ringPool[i].baseAngle = -Math.PI / 2;
      ringPool[i].spawnSpin = 0;
      ringPool[i].speedPxPerS = 0;
      ringPool[i].color = '#ffffff';
      ringPool[i].altGapIndex = -1;
      ringPool[i].flickerTrigger = 0;
      ringPool[i].flickerDone = false;
      ringPool[i].collapseTrigger = 0;
      ringPool[i].collapseWidth = 1;
      ringPool[i].guideStrength = 0;
      ringPool[i].patternTag = 'base';
      ringPool[i].age = 0;
      ringPool[i].dead = false;
    }
  }

  function updateScoreLabel(){
    if(scoreEl){
      scoreEl.textContent = score.toFixed(2);
    }
  }

  function updateMultiplierUI(){
    if(!multiplierFill || !multiplierText){ return; }
    var height = math.clamp(multiplierProgress, 0, 1) * 100;
    multiplierFill.style.height = height.toFixed(2) + '%';
    multiplierText.textContent = multiplier.toFixed(1).replace('.0', '') + '×';
    if(height > 70){
      multiplierBar.classList.add('glow');
    } else {
      multiplierBar.classList.remove('glow');
    }
  }

  function resetMultiplier(impact){
    multiplier = 1;
    multiplierProgress = 0;
    multiplierPulseTimer = 0;
    multiplierDropTimer = impact ? 0.25 : 0;
    updateMultiplierUI();
    multiplierBar.classList.remove('glow');
    if(impact){
      multiplierText.classList.remove('pulse');
      multiplierText.classList.add('shrink');
    } else {
      multiplierText.classList.remove('pulse');
      multiplierText.classList.remove('shrink');
    }
  }

  function addMultiplierProgress(amount){
    multiplierProgress += amount;
    if(multiplierProgress >= 1){
      multiplierProgress -= 1;
      multiplier = Math.round((multiplier + 0.5) * 10) / 10;
      multiplierText.classList.remove('shrink');
      multiplierText.classList.add('pulse');
      multiplierPulseTimer = 0.25;
      audio.playMultUp();
    }
    updateMultiplierUI();
  }

  function updateMultiplierTimers(dt){
    if(multiplierPulseTimer > 0){
      multiplierPulseTimer -= dt;
      if(multiplierPulseTimer <= 0){
        multiplierText.classList.remove('pulse');
      }
    }
    if(multiplierDropTimer > 0){
      multiplierDropTimer -= dt;
      if(multiplierDropTimer <= 0){
        multiplierText.classList.remove('shrink');
      }
    }
  }

  function showBanner(text){
    if(!banner){ return; }
    banner.textContent = text;
    banner.classList.remove('hidden');
    banner.classList.add('show');
    bannerTimer = 1.2;
    bannerActive = true;
  }

  function hideBanner(){
    if(!banner){ return; }
    banner.classList.remove('show');
    banner.classList.add('hidden');
    bannerActive = false;
  }

  function updateBanner(dt){
    if(!bannerActive){ return; }
    bannerTimer -= dt;
    if(bannerTimer <= 0){
      hideBanner();
    }
  }

  function showOverlay(msg){
    if(!overlay){ return; }
    message.textContent = msg;
    overlay.classList.remove('hidden');
  }

  function hideOverlay(){
    if(overlay){
      overlay.classList.add('hidden');
    }
  }

  function spawnRing(info){
    var ring = getRing();
    if(!ring){ return; }
    var sides = info.laneCount === undefined ? logicalSides : info.laneCount;
    sides = Math.max(3, Math.round(sides));
    var telegraph = info.telegraph === undefined ? 0.3 : info.telegraph;
    ring.moving = false;
    ring.telegraph = telegraph > 0 ? telegraph : 0;
    ring.telegraphMax = ring.telegraph;
    ring.radiusOuter = PLAYFIELD_RADIUS;
    ring.thickness = obstacleThickness;
    ring.radiusInner = Math.max(0, ring.radiusOuter - ring.thickness);
    ring.sides = sides;
    ring.segAngle = TWO_PI / ring.sides;
    ring.baseAngle = info.angleOffset === undefined ? -Math.PI / 2 : info.angleOffset;
    ring.spawnSpin = worldSpinAngle;
    var gapIndex = info.gapIndex === undefined ? 0 : info.gapIndex;
    ring.gapIndex = ((gapIndex % ring.sides) + ring.sides) % ring.sides;
    var gapRatio = info.gapWidth === undefined ? 1 : info.gapWidth;
    ring.gapSpanRatio = math.clamp(gapRatio, 0, 1);
    ring.speedPxPerS = typeof info.speed === 'number' ? info.speed : 120;
    if(!PALETTE || PALETTE.length === 0){
      ring.color = '#3DE0B4';
    } else {
      ring.color = PALETTE[(colorIndex++) % PALETTE.length];
    }
    if(info.altGapIndex === undefined){
      ring.altGapIndex = -1;
    } else {
      var alt = info.altGapIndex;
      ring.altGapIndex = ((alt % ring.sides) + ring.sides) % ring.sides;
    }
    ring.flickerTrigger = info.flickerTrigger || 0;
    ring.flickerDone = false;
    ring.collapseTrigger = info.collapseTrigger || 0;
    var collapseRatio = info.collapseWidth === undefined ? ring.gapSpanRatio : info.collapseWidth;
    ring.collapseWidth = math.clamp(collapseRatio, 0, 1);
    ring.patternTag = info.patternTag || 'base';
    var guideStrength = info.guideStrength;
    if(guideStrength === undefined){ guideStrength = gapGuideFade; }
    ring.guideStrength = guideStrength;
    ring.age = 0;
    ring.dead = false;
    if(ring.telegraph <= 0){
      ring.telegraph = 0;
      ring.telegraphMax = 0;
      ring.moving = true;
    }
  }

  function updateRing(ring, dt){
    if(ring.telegraph > 0){
      ring.telegraph -= dt;
      if(ring.telegraph <= 0){
        ring.telegraph = 0;
        ring.telegraphMax = 0;
        ring.moving = true;
      }
      return;
    }
    if(!ring.moving || ring.dead){ return; }
    ring.age += dt;
    ring.radiusOuter -= ring.speedPxPerS * dt;
    if(ring.radiusOuter < 0){ ring.radiusOuter = 0; }
    ring.radiusInner = Math.max(0, ring.radiusOuter - ring.thickness);
    if(ring.flickerTrigger && !ring.flickerDone && ring.radiusOuter < ring.flickerTrigger){
      if(ring.altGapIndex !== -1){
        ring.gapIndex = ring.altGapIndex;
        if(ring.gapIndex < 0){
          ring.gapIndex = (ring.gapIndex % ring.sides + ring.sides) % ring.sides;
        }
      }
      ring.flickerDone = true;
    }
    if(ring.collapseTrigger && ring.gapSpanRatio > ring.collapseWidth && ring.radiusOuter < ring.collapseTrigger){
      ring.gapSpanRatio = ring.collapseWidth;
    }
    if(ring.radiusInner <= TUNE.PLAYER_ORBIT_RADIUS_PX - 2 || ring.radiusOuter <= 0){
      ring.dead = true;
      releaseRing(ring);
    }
  }

  function updateRings(dt){
    for(var i=rings.length - 1;i>=0;i--){
      var ring = rings[i];
      if(!ring.active){
        rings.splice(i, 1);
        continue;
      }
      updateRing(ring, dt);
      if(!ring.active){
        rings.splice(i, 1);
      }
    }
  }

  function drawAnnularWedge(rInner, rOuter, start, end){
    if(end <= start || rOuter <= 0){ return; }
    var inner = rInner < 0 ? 0 : rInner;
    if(inner > rOuter){ inner = rOuter; }
    ctx.beginPath();
    ctx.arc(0, 0, rOuter, start, end, false);
    if(inner > 0){
      ctx.arc(0, 0, inner, end, start, true);
    } else {
      ctx.lineTo(0, 0);
    }
    ctx.closePath();
    ctx.fill();
  }

  function renderRingSegments(ring, rInner, rOuter){
    if(ring.sides <= 0 || ring.segAngle <= 0){ return; }
    var gapRatio = math.clamp(ring.gapSpanRatio, 0, 1);
    var gapSpan = ring.segAngle * gapRatio;
    var blockedSpan = ring.segAngle - gapSpan;
    var epsilon = math.eps();
    for(var i=0;i<ring.sides;i++){
      var start = ring.baseAngle + i * ring.segAngle;
      var end = start + ring.segAngle;
      if(i === ring.gapIndex){
        if(blockedSpan <= epsilon){ continue; }
        var half = blockedSpan * 0.5;
        drawAnnularWedge(rInner, rOuter, start, start + half);
        drawAnnularWedge(rInner, rOuter, end - half, end);
      } else {
        drawAnnularWedge(rInner, rOuter, start, end);
      }
    }
  }

  function checkRingCollision(ring){
    if(!ring.moving || ring.dead){ return false; }
    if(ring.sides <= 0 || ring.segAngle <= 0){ return false; }
    var epsilon = math.eps();
    var playerRadius = player.radius;
    if(playerRadius > ring.radiusOuter + epsilon){ return false; }
    if(playerRadius < ring.radiusInner - epsilon){ return false; }
    var aPlayerWorld = math.normAngle(player.angle);
    var relative = math.normAngle(aPlayerWorld - worldSpinAngle - ring.baseAngle);
    var idx = Math.floor(relative / ring.segAngle);
    if(idx < 0){ idx += ring.sides; }
    idx = idx % ring.sides;
    if(idx === ring.gapIndex){
      var segPos = relative - idx * ring.segAngle;
      if(segPos < 0){ segPos += ring.segAngle; }
      var gapSpan = ring.segAngle * ring.gapSpanRatio;
      if(gapSpan >= ring.segAngle - epsilon){
        return false;
      }
      var blockedMargin = (ring.segAngle - gapSpan) * 0.5;
      if(segPos >= blockedMargin - epsilon && segPos <= ring.segAngle - blockedMargin + epsilon){
        return false;
      }
    }
    return true;
  }

  function renderTelegraph(ring){
    if(ring.telegraph <= 0){ return; }
    var progress = ring.telegraphMax > 0 ? 1 - (ring.telegraph / ring.telegraphMax) : 1;
    var alpha = math.clamp(progress, 0, 1);
    var rOuter = ring.radiusOuter;
    var rInner = Math.max(0, rOuter - ring.thickness);
    ctx.save();
    ctx.globalAlpha = 0.15 + alpha * 0.35;
    ctx.fillStyle = ring.color;
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    renderRingSegments(ring, rInner, rOuter);
    ctx.restore();
  }

  function renderRing(ring){
    if(!ring.moving || ring.dead){ return; }
    var rOuter = ring.radiusOuter;
    var rInner = Math.max(0, ring.radiusInner);
    var nearPlayer = rOuter < player.radius + 28;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ring.color;
    ctx.shadowColor = ring.color;
    ctx.shadowBlur = nearPlayer ? 22 : 12;
    renderRingSegments(ring, rInner, rOuter);
    ctx.restore();

    if(ring.moving && ring.guideStrength > 0.01 && survivalTime < 45){
      var gapCenter = ring.baseAngle + ring.gapIndex * ring.segAngle + ring.segAngle * 0.5;
      var arrowRadius = rOuter + 36;
      var arrowAlpha = ring.guideStrength * (1 - survivalTime / 45);
      ctx.save();
      ctx.rotate(gapCenter);
      ctx.globalAlpha = math.clamp(arrowAlpha, 0, 1);
      ctx.fillStyle = 'rgba(61,224,180,0.7)';
      ctx.beginPath();
      ctx.moveTo(0, -arrowRadius);
      ctx.lineTo(8, -arrowRadius + 18);
      ctx.lineTo(-8, -arrowRadius + 18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function renderArenaPolygon(){
    var progress = morphDuration <= 0 ? 1 : math.clamp(morphTimer / morphDuration, 0, 1);
    displaySides = math.lerp(previousSides, targetSides, math.easeInOut(progress));
    var effectiveSides = Math.max(3, Math.round(displaySides));
    var angleStep = TWO_PI / effectiveSides;
    var radius = TUNE.PLAYER_ORBIT_RADIUS_PX + (PLAYFIELD_RADIUS - TUNE.PLAYER_ORBIT_RADIUS_PX) * 0.68;
    ctx.save();
    ctx.beginPath();
    for(var i=0;i<effectiveSides;i++){
      var angle = angleStep * i - Math.PI / 2;
      var x = Math.cos(angle) * radius;
      var y = Math.sin(angle) * radius;
      if(i === 0){ ctx.moveTo(x, y); }
      else { ctx.lineTo(x, y); }
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(61,224,180,0.35)';
    ctx.lineWidth = 6;
    ctx.shadowColor = 'rgba(61,224,180,0.35)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 12;
    ctx.shadowBlur = 30;
    ctx.stroke();
    ctx.restore();
  }

  function renderBackground(time){
    ctx.save();
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    var pulse = 0.25 + Math.sin(time * 2.4) * 0.12;
    var grad = ctx.createRadialGradient(CENTER_X, CENTER_Y, 20, CENTER_X, CENTER_Y, 360);
    grad.addColorStop(0, 'rgba(61,224,180,' + (0.18 + pulse * 0.3).toFixed(3) + ')');
    grad.addColorStop(0.45, 'rgba(127,81,255,' + (0.08 + pulse * 0.18).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(13,15,18,1)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function renderPlayer(){
    ctx.save();
    ctx.rotate(player.angle + Math.PI / 2);
    ctx.translate(0, -player.radius);
    var side = TUNE.PLAYER_SIZE_PX;
    var h = side * Math.sqrt(3) / 2;
    ctx.beginPath();
    ctx.moveTo(0, -2 * h / 3);
    ctx.lineTo(side / 2, h / 3);
    ctx.lineTo(-side / 2, h / 3);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#3DE0B4';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(61,224,180,0.85)';
    ctx.stroke();
    ctx.restore();
  }

  function renderRings(){
    var telegraphs = [];
    var actives = [];
    for(var i=0;i<rings.length;i++){
      var ring = rings[i];
      if(!ring.active){ continue; }
      if(ring.telegraph > 0){ telegraphs.push(ring); }
      if(ring.moving && !ring.dead){ actives.push(ring); }
    }
    telegraphs.sort(function(a, b){ return b.radiusOuter - a.radiusOuter; });
    actives.sort(function(a, b){ return b.radiusOuter - a.radiusOuter; });
    for(var t=0;t<telegraphs.length;t++){ renderTelegraph(telegraphs[t]); }
    for(var r=0;r<actives.length;r++){ renderRing(actives[r]); }
  }

  function updatePlayer(dt){
    var left = input.left();
    var right = input.right();
    var inputAxis = (right ? 1 : 0) - (left ? 1 : 0);
    var difficulty = math.clamp(survivalTime / 60, 0, 1);
    var maxSpeed = TUNE.PLAYER_TURN_SPEED_RAD_S + difficulty * 1.2;
    var accel = TUNE.PLAYER_TURN_ACCEL_RAD_S2 + difficulty * 8;
    var damping = Math.max(10, 24 - difficulty * 8);
    player.velocity += inputAxis * accel * dt;
    if(player.velocity > maxSpeed){ player.velocity = maxSpeed; }
    if(player.velocity < -maxSpeed){ player.velocity = -maxSpeed; }
    if(inputAxis === 0){
      player.velocity -= player.velocity * damping * dt;
    }
    player.angle = math.normAngle(player.angle + player.velocity * dt);

    if(Math.abs(player.velocity) > 1.8){
      tiltTimer = 0.18;
      container.classList.toggle('tilt-left', player.velocity < 0);
      container.classList.toggle('tilt-right', player.velocity > 0);
    } else {
      if(tiltTimer > 0){
        tiltTimer -= dt;
      } else {
        container.classList.remove('tilt-left');
        container.classList.remove('tilt-right');
      }
    }
  }

  function handleCheckpoint(){
    if(survivalTime >= nextCheckpoint){
      nextCheckpoint += 20;
      showBanner('CHECKPOINT');
    }
  }

  function scheduleMorph(){
    var nextSides = math.randi(5, 8);
    if(nextSides === logicalSides){
      nextSides = nextSides === 8 ? 5 : nextSides + 1;
    }
    previousSides = displaySides;
    targetSides = nextSides;
    morphTimer = 0;
    morphDuration = 0.6;
    spawnPauseTimer = 0.45;
    patternManager.defer(spawnPauseTimer);
    showBanner('MORPH');
  }

  function scheduleSpin(){
    if(!TUNE.ENABLE_ARENA_SPIN){ return; }
    spinTimer = 2 + math.randf(0, 0.8);
    spinVelocity = (math.randf() > 0.5 ? 1 : -1) * (0.9 + Math.min(1.8, survivalTime / 30));
    showBanner('SPIN');
  }

  function updateMorph(dt){
    if(targetSides !== previousSides){
      morphTimer += dt;
      if(morphTimer >= morphDuration){
        previousSides = targetSides;
        morphDuration = 0;
        morphTimer = 0;
        logicalSides = Math.round(targetSides);
      }
    }
  }

  function updateSpin(dt){
    if(TUNE.ENABLE_ARENA_SPIN){
      var jitter = Math.sin(globalTime * TWO_PI * TUNE.SPIN_JITTER_FREQ_HZ) * TUNE.SPIN_SPEED_JITTER;
      var baseSpin = TUNE.SPIN_BASE_SPEED_RAD_S + jitter;
      worldSpinAngle += baseSpin * dt;
      if(spinTimer > 0){
        spinTimer -= dt;
        worldSpinAngle += spinVelocity * dt;
        spinVelocity *= 0.985;
        if(spinTimer <= 0){
          spinVelocity = 0;
        }
      } else if(Math.abs(spinVelocity) > 0.0001){
        worldSpinAngle += spinVelocity * dt;
        spinVelocity *= 0.96;
        if(Math.abs(spinVelocity) < 0.00005){
          spinVelocity = 0;
        }
      }
      if(worldSpinAngle > TWO_PI || worldSpinAngle < -TWO_PI){
        worldSpinAngle = math.normAngle(worldSpinAngle);
      }
    } else {
      worldSpinAngle = 0;
      spinTimer = 0;
      spinVelocity = 0;
    }

    if(TUNE.ENABLE_ARENA_ZOOM){
      worldZoom = 1 + TUNE.ZOOM_AMPLITUDE * Math.sin(globalTime * TWO_PI * TUNE.ZOOM_FREQ_HZ);
    } else {
      worldZoom = 1;
    }
  }

  function updateDifficulty(dt){
    gapGuideFade = math.clamp(1 - survivalTime / 40, 0, 1);
    if(TUNE.ENABLE_ARENA_SPIN && survivalTime > nextSpinAt){
      scheduleSpin();
      nextSpinAt += 12 + math.randf(0, 10);
    }
    if(survivalTime > 18 && morphTimer === 0 && morphDuration === 0 && math.randf() < 0.002){
      scheduleMorph();
    }
  }

  function updateChecksum(){
    if(!Number.isFinite(score) || !Number.isFinite(multiplier)){
      prepareReadyState();
      return;
    }
    var activeCount = 0;
    for(var i=0;i<ringPool.length;i++){
      if(ringPool[i].active){ activeCount++; }
    }
    checksum = ((activeCount << 3) ^ ((score * 17) | 0) ^ ((multiplier * 31) | 0) ^ checksumSalt) >>> 0;
  }

  function render(){
    renderBackground(globalTime);
    ctx.save();
    ctx.translate(CENTER_X, CENTER_Y);
    if(TUNE.ENABLE_ARENA_SPIN){
      ctx.rotate(worldSpinAngle);
    }
    if(TUNE.ENABLE_ARENA_ZOOM){
      ctx.scale(worldZoom, worldZoom);
    }
    renderArenaPolygon();
    renderRings();
    renderPlayer();
    ctx.restore();
  }

  function resetRunData(){
    clearRings();
    colorIndex = 0;
    player.angle = -Math.PI / 2;
    player.velocity = 0;
    player.radius = TUNE.PLAYER_ORBIT_RADIUS_PX;
    survivalTime = 0;
    score = 0;
    multiplier = 1;
    multiplierProgress = 0;
    multiplierPulseTimer = 0;
    multiplierDropTimer = 0;
    nextCheckpoint = 20;
    logicalSides = 6;
    displaySides = 6;
    previousSides = 6;
    targetSides = 6;
    morphTimer = 0;
    morphDuration = 0;
    spawnPauseTimer = 0;
    worldSpinAngle = 0;
    worldZoom = 1;
    spinVelocity = 0;
    spinTimer = 0;
    nextSpinAt = 12;
    checksumSalt = (math.randf() * 0xFFFFFFFF) >>> 0;
    checksum = 0;
    gapGuideFade = 1;
    bannerTimer = 0;
    bannerActive = false;
    tiltTimer = 0;
    updateScoreLabel();
    updateMultiplierUI();
    multiplierText.classList.remove('pulse');
    multiplierText.classList.remove('shrink');
    multiplierBar.classList.remove('glow');
    container.classList.remove('tilt-left');
    container.classList.remove('tilt-right');
  }

  function buildPattern(name){
    var lanes = logicalSides;
    var difficulty = Math.min(1.5 + survivalTime / 45, 4.5);
    if(name === 'spiral'){
      var baseGap = math.randi(0, lanes - 1);
      var dir = math.randf() > 0.5 ? 1 : -1;
      var drift = math.randf(0.3, 0.6);
      var count = 6 + math.randi(0, 3);
      var offset = 0;
      return {
        delay: 0.48,
        next: function(){
          if(count-- <= 0){ return null; }
          offset += drift;
          var step = TWO_PI / lanes;
          var info = {
            laneCount: lanes,
            gapIndex: baseGap,
            angleOffset: -Math.PI / 2 + offset * step * 0.18,
            speed: 110 + difficulty * 22,
            guideStrength: gapGuideFade,
            patternTag: 'spiral'
          };
          baseGap = (baseGap + dir + lanes) % lanes;
          return info;
        }
      };
    }
    if(name === 'alternating'){
      var startGap = math.randi(0, lanes - 1);
      var opposite = (startGap + Math.floor(lanes / 2)) % lanes;
      var flips = 8;
      var toggle = false;
      return {
        delay: 0.5,
        next: function(){
          if(flips-- <= 0){ return null; }
          toggle = !toggle;
          return {
            laneCount: lanes,
            gapIndex: toggle ? startGap : opposite,
            speed: 115 + difficulty * 24,
            angleOffset: -Math.PI / 2,
            guideStrength: gapGuideFade,
            patternTag: 'alternating'
          };
        }
      };
    }
    if(name === 'pingPong'){
      var idx = math.randi(0, lanes - 1);
      var direction = 1;
      var swings = lanes * 2;
      return {
        delay: 0.42,
        next: function(){
          if(swings-- <= 0){ return null; }
          var info = {
            laneCount: lanes,
            gapIndex: idx,
            speed: 120 + difficulty * 26,
            angleOffset: -Math.PI / 2,
            guideStrength: gapGuideFade,
            patternTag: 'pingPong'
          };
          idx += direction;
          if(idx <= 0 || idx >= lanes - 1){ direction *= -1; }
          idx = (idx + lanes) % lanes;
          return info;
        }
      };
    }
    if(name === 'collapse'){
      var collapseGap = math.randi(0, lanes - 1);
      var waves = 5 + math.randi(0, 2);
      return {
        delay: 0.46,
        next: function(){
          if(waves-- <= 0){ return null; }
          return {
            laneCount: lanes,
            gapIndex: collapseGap,
            speed: 125 + difficulty * 24,
            angleOffset: -Math.PI / 2,
            gapWidth: 1,
            collapseTrigger: TUNE.PLAYER_ORBIT_RADIUS_PX + 36,
            collapseWidth: 0.35,
            guideStrength: gapGuideFade,
            patternTag: 'collapse'
          };
        }
      };
    }
    if(name === 'flicker'){
      var flickerGap = math.randi(0, lanes - 1);
      var alt = (flickerGap + math.randi(1, lanes - 1)) % lanes;
      var bursts = 6;
      return {
        delay: 0.44,
        next: function(){
          if(bursts-- <= 0){ return null; }
          var info = {
            laneCount: lanes,
            gapIndex: flickerGap,
            altGapIndex: alt,
            flickerTrigger: TUNE.PLAYER_ORBIT_RADIUS_PX + 70,
            speed: 120 + difficulty * 28,
            angleOffset: -Math.PI / 2,
            guideStrength: gapGuideFade,
            patternTag: 'flicker'
          };
          flickerGap = (flickerGap + math.randi(1, 2)) % lanes;
          alt = (flickerGap + math.randi(1, lanes - 1)) % lanes;
          return info;
        }
      };
    }
    if(name === 'inwardBurst'){
      var burstCount = 4;
      return {
        delay: 0.2,
        next: function(){
          if(burstCount-- <= 0){ return null; }
          return {
            laneCount: lanes,
            gapIndex: math.randi(0, lanes - 1),
            speed: 150 + difficulty * 35,
            angleOffset: -Math.PI / 2,
            guideStrength: gapGuideFade,
            telegraph: 0.18,
            patternTag: 'inwardBurst'
          };
        }
      };
    }
    return null;
  }

  var lastPattern = '';
  var PATTERN_NAMES = ['spiral', 'alternating', 'pingPong', 'collapse', 'flicker', 'inwardBurst'];

  function choosePattern(){
    var available = PATTERN_NAMES.slice();
    var idx = available.indexOf(lastPattern);
    if(idx !== -1){ available.splice(idx, 1); }
    var pick = available[math.randi(0, available.length - 1)];
    lastPattern = pick;
    return buildPattern(pick);
  }

  var patternManager = (function(){
    var activePattern = null;
    var nextSpawnAt = Infinity;

    function computeInterval(time, minimum){
      var steps = time > 0 ? time / 10 : 0;
      var factor = Math.pow(TUNE.DIFFICULTY_SPAWN_ACCEL, steps);
      var interval = math.randf(TUNE.SPAWN_MIN_INTERVAL_S, TUNE.SPAWN_MAX_INTERVAL_S) * factor;
      if(typeof minimum === 'number'){
        interval = Math.max(interval, minimum);
      }
      if(interval < 0.08){ interval = 0.08; }
      return interval;
    }

    function schedule(time, minimum){
      nextSpawnAt = time + computeInterval(time, minimum);
    }

    function reset(time){
      activePattern = null;
      lastPattern = '';
      var firstInterval = Math.min(0.6, math.randf(TUNE.SPAWN_MIN_INTERVAL_S, TUNE.SPAWN_MAX_INTERVAL_S));
      nextSpawnAt = time + Math.max(0.08, firstInterval);
    }

    function spawnNext(time){
      if(!activePattern){
        activePattern = choosePattern();
        if(!activePattern){
          schedule(time);
          return;
        }
      }
      var spawn = activePattern.next();
      if(!spawn){
        activePattern = null;
        schedule(time, 0.35 + math.randf(0, 0.3));
        return;
      }
      spawn.speed += math.randf(-8, 8);
      spawn.patternTag = spawn.patternTag || 'base';
      spawn.laneCount = spawn.laneCount || logicalSides;
      spawn.gapIndex = ((spawn.gapIndex % spawn.laneCount) + spawn.laneCount) % spawn.laneCount;
      spawn.guideStrength = spawn.guideStrength === undefined ? gapGuideFade : spawn.guideStrength;
      spawnRing(spawn);
      audio.playTick();
      var minDelay = 0;
      if(typeof spawn.delay === 'number'){ minDelay = spawn.delay; }
      else if(activePattern && typeof activePattern.delay === 'number'){ minDelay = activePattern.delay; }
      schedule(time, minDelay);
    }

    return {
      start: function(time){ reset(time); },
      reset: function(time){ reset(time); },
      update: function(time){
        if(state !== 'RUN'){ return; }
        while(time >= nextSpawnAt){
          spawnNext(time);
          if(nextSpawnAt <= time){
            nextSpawnAt = time + 0.08;
            break;
          }
        }
      },
      defer: function(amount){
        nextSpawnAt += amount;
        if(nextSpawnAt < survivalTime + 0.08){
          nextSpawnAt = survivalTime + 0.08;
        }
      }
    };
  })();

  function setState(next){
    state = next;
  }

  function prepareReadyState(){
    resetRunData();
    resetMultiplier(false);
    patternManager.reset(0);
    hideOverlay();
    showBanner('READY');
    setState('READY');
    isStarting = false;
    colorIndex = 0;
  }

  function startRun(){
    if(state !== 'READY' || isStarting){ return; }
    isStarting = true;
    audio.ensure();
    hideOverlay();
    multiplierText.classList.remove('pulse');
    multiplierText.classList.remove('shrink');
    multiplierBar.classList.remove('glow');
    spawnPauseTimer = 0;
    patternManager.start(survivalTime);
    setState('RUN');
    isStarting = false;
  }

  function gameOver(){
    if(state !== 'RUN'){ return; }
    resetMultiplier(true);
    audio.playDeath();
    container.classList.add('shake');
    window.setTimeout(function(){ container.classList.remove('shake'); }, 120);
    showOverlay('GAME OVER');
    if(playAgain){
      try { playAgain.focus({ preventScroll: true }); } catch(_e){}
    }
    setState('GAME_OVER');
  }

  function pollStartIntent(){
    var triggered = false;
    if(typeof input.startPressedOnce === 'function' && input.startPressedOnce()){ triggered = true; }
    if(typeof input.pointerStartPressedOnce === 'function' && input.pointerStartPressedOnce()){ triggered = true; }
    if(!triggered){ return; }
    if(state === 'READY'){
      startRun();
      audio.playStart();
    } else if(state === 'GAME_OVER'){
      prepareReadyState();
      startRun();
      audio.playStart();
    }
  }

  function handleMuteInput(){
    if(typeof input.mutePressedOnce === 'function' && input.mutePressedOnce()){
      var muted = audio.toggleMute();
      showBanner(muted ? 'MUTED' : 'UNMUTED');
    }
  }

  function updateRun(dt){
    survivalTime += dt;
    score += dt * multiplier;
    updateScoreLabel();
    addMultiplierProgress(dt * 0.06 + survivalTime * 0.0004);
    handleCheckpoint();
    updateDifficulty(dt);
    if(spawnPauseTimer > 0){
      spawnPauseTimer -= dt;
      if(spawnPauseTimer < 0){ spawnPauseTimer = 0; }
    }
    if(spawnPauseTimer <= 0){
      patternManager.update(survivalTime);
    }
    updateRings(dt);
    updateMorph(dt);
    updateSpin(dt);
    updatePlayer(dt);

    for(var i=rings.length - 1;i>=0;i--){
      if(rings[i].active && checkRingCollision(rings[i])){
        gameOver();
        break;
      }
    }

    updateChecksum();
  }

  function updateReady(dt){
    updateSpin(dt);
    updateMorph(dt);
  }

  function updateGameOver(dt){
    updateSpin(dt * 0.5);
  }

  function fixedUpdate(dt){
    globalTime += dt;
    updateBanner(dt);
    updateMultiplierTimers(dt);
    handleMuteInput();
    pollStartIntent();

    if(state === 'RUN'){
      updateRun(dt);
    } else if(state === 'READY'){
      updateReady(dt);
    } else if(state === 'GAME_OVER'){
      updateGameOver(dt);
    }
  }

  function applyScaling(){
    dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    refreshObstacleThickness();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = false;
  }

  function loop(now){
    requestAnimationFrame(loop);
    if(!lastTimestamp){ lastTimestamp = now; }
    var delta = (now - lastTimestamp) / 1000;
    if(delta < 0){ delta = 0; }
    if(delta > 0.05){ delta = 0.05; }
    lastTimestamp = now;
    accumulator += delta;
    while(accumulator >= STEP_RATE){
      fixedUpdate(STEP_RATE);
      accumulator -= STEP_RATE;
    }
    render();
  }

  function bindEvents(){
    if(!playAgain){ return; }
    playAgain.addEventListener('click', function(ev){
      ev.preventDefault();
      playAgain.blur();
      prepareReadyState();
    });
  }

  function init(){
    if(initCalled){ return; }
    initCalled = true;

    container = doc.getElementById('container');
    canvas = doc.getElementById('game');
    ctx = canvas.getContext('2d', { alpha: false });
    scoreEl = doc.getElementById('score');
    banner = doc.getElementById('banner');
    overlay = doc.getElementById('overlay');
    message = doc.getElementById('message');
    playAgain = doc.getElementById('playAgain');
    multiplierFill = doc.getElementById('multiplierFill');
    multiplierText = doc.getElementById('multiplierText');
    multiplierBar = doc.getElementById('multiplierBar');

    try { Object.seal(canvas); } catch(_e){}
    try { Object.seal(ctx); } catch(_e){}

    buildPalette();
    applyScaling();
    window.addEventListener('resize', applyScaling);

    canvas.addEventListener('contextmenu', function(ev){ ev.preventDefault(); });

    bindEvents();

    prepareReadyState();
    hideOverlay();

    lastTimestamp = performance.now();
    requestAnimationFrame(loop);
  }

  if(doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  Object.freeze(root);
})();
