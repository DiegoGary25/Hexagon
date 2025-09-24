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
    // Player orbit / feel
    PLAYER_ORBIT_RADIUS_PX: 90,
    PLAYER_SIZE_PX: 12,
    PLAYER_TURN_SPEED_RAD_S: 5,     // base turn speed at timescale = 1
    PLAYER_TURN_ACCEL_RAD_S2: 40.0, // IGNORE: movement is instant (no accel)

    // Beat-synced spawns
    SPAWN_INTERVAL_S: 0.6,          // constant beat; no randomness

    // Arena motion (unchanged)
    ENABLE_ARENA_SPIN: true,
    SPIN_BASE_SPEED_RAD_S: 0.65,
    SPIN_SPEED_JITTER: 0.08,
    SPIN_JITTER_FREQ_HZ: 0.25,
    ENABLE_ARENA_ZOOM: true,
    ZOOM_AMPLITUDE: 0.05,
    ZOOM_FREQ_HZ: 0.45,

    // Visual margins & spawns
    PLAYFIELD_PADDING_PX: 56,
    SPAWN_OUTER_MARGIN_PX: 64,

    // Obstacle geometry
    OBSTACLE_THICKNESS_PX: 5,

    // Collision tolerances
    COLLISION_RADIAL_EPS_PX: 2.0,
    COLLISION_ANGULAR_EPS_RAD: 0.015,

    // NEW: global difficulty timescale (applies to BOTH player turn speed and ring radial speed)
    GLOBAL_SPEED_MODE: 'expo',        // 'expo' recommended (smooth & multiplicative)
    SPEEDUP_FACTOR_PER_MIN: 1.10,     // every 60s, speeds ×1.10 (obstacles AND player)
    MAX_SPEEDUP_FACTOR: 2.5           // clamp overall scale so it doesn’t get absurd
  });
  /* ========= /TUNABLES ========= */

  var STEP_RATE = 1 / 120;
  var TAU = Math.PI * 2;
  var TWO_PI = TAU;

  const PHASE_OFFSET_RAD = -Math.PI / 2;
  const DEBUG_OVERLAY = false;

  var dpr = window.devicePixelRatio || 1;
  var viewRadius = 0;
  var spawnMarginPx = 0;
  var spawnRadiusCss = 0;
  var spawnRadiusDevice = 0;
  var playfieldRadius = 0;
  var baseObstacleThickness = 0;
  var obstacleThickness = 0;
  var radialEpsDevice = 0;

  var PALETTE = null;
  var colorIndex = 0;

  function refreshArenaMetrics(){
    spawnMarginPx = Math.max(0, TUNE.SPAWN_OUTER_MARGIN_PX);
    baseObstacleThickness = math.clamp(TUNE.OBSTACLE_THICKNESS_PX, 1, 64);
    obstacleThickness = baseObstacleThickness * dpr;
    radialEpsDevice = TUNE.COLLISION_RADIAL_EPS_PX * dpr;

    if(canvas){
      var viewWidth = canvas.width / dpr;
      var viewHeight = canvas.height / dpr;
      viewRadius = Math.min(viewWidth, viewHeight) * 0.5;
    } else {
      viewRadius = Math.min(WIDTH, HEIGHT) * 0.5;
    }

    playfieldRadius = Math.max(0, viewRadius - TUNE.PLAYFIELD_PADDING_PX);
    spawnRadiusCss = viewRadius + spawnMarginPx;
    spawnRadiusDevice = spawnRadiusCss * dpr;
  }

  function getFrameRotation(){
    return TUNE.ENABLE_ARENA_SPIN ? worldSpinAngle : 0;
  }

  function getFrameZoom(){
    return TUNE.ENABLE_ARENA_ZOOM ? worldZoom : 1;
  }

  refreshArenaMetrics();

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

  var state = 'BOOT';
  var isStarting = false;
  var initCalled = false;

  var accumulator = 0;
  var lastTimestamp = 0;
  var globalTime = 0;

  var survivalTime = 0;
  var currentTimescale = 1;
  var nextBeatTime = Infinity;

  var logicalSides = 6;
  var displaySides = 6;
  var targetSides = 6;
  var previousSides = 6;
  var morphTimer = 0;
  var morphDuration = 0;
  var worldSpinAngle = 0;
  var worldZoom = 1;
  var spinVelocity = 0;
  var spinTimer = 0;
  var checksumSalt = 0;
  var checksum = 0;
  var bannerTimer = 0;
  var bannerActive = false;
  var tiltTimer = 0;
  var prevMovementIntent = false;

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
      segAngle: 0,
      phase: PHASE_OFFSET_RAD,
      angleOffset: 0,
      gapIndices: [],
      gapOpen: [],
      color: '#ffffff',
      baseSpeedPxPerS: 0,
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
    ring.segAngle = 0;
    ring.phase = PHASE_OFFSET_RAD;
    ring.angleOffset = 0;
    ring.gapIndices.length = 0;
    ring.gapOpen.length = 0;
    ring.baseSpeedPxPerS = 0;
    ring.color = '#ffffff';
    ring.patternTag = 'base';
    ring.age = 0;
    ring.dead = false;
  }

  function clearRings(){
    rings.length = 0;
    for(var i=0;i<ringPool.length;i++){
      var ring = ringPool[i];
      ring.active = false;
      ring.moving = false;
      ring.telegraph = 0;
      ring.telegraphMax = 0;
      ring.radiusOuter = 0;
      ring.radiusInner = 0;
      ring.thickness = 0;
      ring.sides = 0;
      ring.segAngle = 0;
      ring.phase = PHASE_OFFSET_RAD;
      ring.angleOffset = 0;
      ring.gapIndices.length = 0;
      ring.gapOpen.length = 0;
    ring.baseSpeedPxPerS = 0;
      ring.color = '#ffffff';
      ring.patternTag = 'base';
      ring.age = 0;
      ring.dead = false;
    }
  }

  function updateScoreLabel(){
    if(scoreEl){
      scoreEl.textContent = survivalTime.toFixed(2);
    }
  }

  function showBanner(text){
    bannerTimer = 0;
    bannerActive = false;
    if(!banner){ return; }
    banner.textContent = '';
    banner.classList.add('hidden');
    banner.classList.remove('show');
  }

  function hideBanner(){
    bannerTimer = 0;
    bannerActive = false;
    if(!banner){ return; }
    banner.classList.remove('show');
    banner.classList.add('hidden');
  }

  function updateBanner(){ }

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
    var telegraph = typeof info.telegraph === 'number' ? info.telegraph : 0.3;
    ring.moving = false;
    ring.telegraph = telegraph > 0 ? telegraph : 0;
    ring.telegraphMax = ring.telegraph;
    ring.radiusOuter = spawnRadiusDevice;
    ring.thickness = obstacleThickness;
    ring.radiusInner = ring.radiusOuter - ring.thickness;
    ring.sides = sides;
    ring.segAngle = TAU / sides;
    var angleOffset = typeof info.angleOffset === 'number' ? info.angleOffset : 0;
    ring.angleOffset = angleOffset;
    ring.phase = PHASE_OFFSET_RAD + angleOffset;
    var speed = typeof info.speed === 'number' ? info.speed : 120;
    ring.baseSpeedPxPerS = speed * dpr;
    if(!PALETTE || PALETTE.length === 0){
      ring.color = '#3DE0B4';
    } else {
      ring.color = PALETTE[(colorIndex++) % PALETTE.length];
    }
    ring.patternTag = info.patternTag || 'base';
    ring.age = 0;
    ring.dead = false;

    var mask = ring.gapOpen;
    mask.length = sides;
    for(var i=0;i<sides;i++){ mask[i] = false; }
    ring.gapIndices.length = 0;

    var provided = Array.isArray(info.gapIndices) ? info.gapIndices : null;
    if(provided && provided.length > 0){
      for(var g=0; g<provided.length; g++){
        var idx = ((Math.round(provided[g]) % sides) + sides) % sides;
        if(!mask[idx]){
          mask[idx] = true;
          ring.gapIndices.push(idx);
        }
      }
    } else {
      var baseGap = info.gapIndex === undefined ? 0 : info.gapIndex;
      var normalized = ((Math.round(baseGap) % sides) + sides) % sides;
      mask[normalized] = true;
      ring.gapIndices.push(normalized);
    }

    if(ring.gapIndices.length === 0){
      mask[0] = true;
      ring.gapIndices.push(0);
    }

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
    var radialSpeed = ring.baseSpeedPxPerS * currentTimescale;
    ring.radiusOuter -= radialSpeed * dt;
    if(ring.radiusOuter < 0){ ring.radiusOuter = 0; }
    ring.radiusInner = ring.radiusOuter - ring.thickness;
    if(ring.radiusInner < 0){ ring.radiusInner = 0; }
    var recycleLimit = (TUNE.PLAYER_ORBIT_RADIUS_PX * dpr) - 2 * dpr;
    if(ring.radiusInner <= recycleLimit || ring.radiusOuter <= 0){
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

  function drawAnnularWedge(rInnerDevice, rOuterDevice, start, end){
    if(end <= start || rOuterDevice <= 0){ return; }
    var outer = rOuterDevice / dpr;
    if(outer <= 0){ return; }
    var inner = rInnerDevice / dpr;
    if(inner < 0){ inner = 0; }
    if(inner > outer){ inner = outer; }
    ctx.beginPath();
    ctx.arc(0, 0, outer, start, end, false);
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
    var seg = ring.segAngle;
    var open = ring.gapOpen;
    for(var i=0;i<ring.sides;i++){
      if(open[i]){ continue; }
      var start = ring.phase + i * seg;
      var end = start + seg;
      drawAnnularWedge(rInner, rOuter, start, end);
    }
  }

  function checkRingCollision(ring){
    if(!ring.moving || ring.dead){ return false; }
    if(ring.sides <= 0 || ring.segAngle <= 0){ return false; }

    var zoom = getFrameZoom();
    var rOuter = Math.max(0, ring.radiusOuter) * zoom;
    var rInner = Math.max(0, ring.radiusInner) * zoom;
    var playerRadius = TUNE.PLAYER_ORBIT_RADIUS_PX * dpr * zoom;
    var radialPad = radialEpsDevice * zoom;

    if(playerRadius < (rInner - radialPad) || playerRadius > (rOuter + radialPad)){
      return false;
    }

    var playerSize = TUNE.PLAYER_SIZE_PX * dpr * zoom;
    var halfChord = playerSize * 0.5;
    var playerHalfAng = Math.atan2(halfChord, Math.max(playerRadius, halfChord + 1));

    var aWorld = math.normAngle(player.angle);
    var localAngle = math.normAngle(aWorld - ring.phase);
    var seg = ring.segAngle;
    var angPad = playerHalfAng + TUNE.COLLISION_ANGULAR_EPS_RAD;
    var gaps = ring.gapIndices;

    if(!gaps || gaps.length === 0){
      return true;
    }

    for(var i=0;i<gaps.length;i++){
      var gapIdx = gaps[i];
      var gapStart = gapIdx * seg;
      var gapEnd = gapStart + seg;
      if(math.angleInInterval(localAngle, gapStart - angPad, gapEnd + angPad)){
        return false;
      }
    }

    return true;
  }

  function renderTelegraph(ring){
    if(ring.telegraph <= 0){ return; }
    var progress = ring.telegraphMax > 0 ? 1 - (ring.telegraph / ring.telegraphMax) : 1;
    var alpha = math.clamp(progress, 0, 1);
    var rOuter = Math.max(0, ring.radiusOuter);
    var rInner = Math.max(0, ring.radiusInner);
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
    var rOuter = Math.max(0, ring.radiusOuter);
    var rInner = Math.max(0, ring.radiusInner);
    var nearPlayer = (rOuter / dpr) < TUNE.PLAYER_ORBIT_RADIUS_PX + 28;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ring.color;
    ctx.shadowColor = ring.color;
    ctx.shadowBlur = nearPlayer ? 22 : 12;
    renderRingSegments(ring, rInner, rOuter);
    ctx.restore();
  }

  function renderArenaPolygon(){
    var progress = morphDuration <= 0 ? 1 : math.clamp(morphTimer / morphDuration, 0, 1);
    displaySides = math.lerp(previousSides, targetSides, math.easeInOut(progress));
    var effectiveSides = Math.max(3, Math.round(displaySides));
    var angleStep = TWO_PI / effectiveSides;
    var radius = TUNE.PLAYER_ORBIT_RADIUS_PX + (playfieldRadius - TUNE.PLAYER_ORBIT_RADIUS_PX) * 0.68;
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

  function renderDebugOverlay(){
    if(!DEBUG_OVERLAY){ return; }
    var candidate = null;
    var bestDistance = Infinity;
    var playerRadiusDevice = TUNE.PLAYER_ORBIT_RADIUS_PX * dpr;
    for(var i=0;i<rings.length;i++){
      var ring = rings[i];
      if(!ring.active || !ring.moving || ring.dead){ continue; }
      var inner = Math.max(0, ring.radiusInner);
      var outer = Math.max(inner, ring.radiusOuter);
      if(playerRadiusDevice >= inner && playerRadiusDevice <= outer){
        candidate = ring;
        break;
      }
      var mid = (inner + outer) * 0.5;
      var diff = Math.abs(mid - playerRadiusDevice);
      if(diff < bestDistance){
        bestDistance = diff;
        candidate = ring;
      }
    }
    if(!candidate){ return; }

    var seg = candidate.segAngle;
    if(seg <= 0 || candidate.sides <= 0){ return; }
    var aWorld = math.normAngle(player.angle);
    var aRel = math.normAngle(aWorld - candidate.phase);
    var idx = Math.floor(aRel / seg) % candidate.sides;
    if(idx < 0){ idx += candidate.sides; }
    var primaryGap = candidate.gapIndices.length > 0 ? candidate.gapIndices[0] : 0;
    var gapStart = primaryGap * seg;
    var gapEnd = gapStart + seg;

    var rInnerCss = Math.max(0, candidate.radiusInner) / dpr;
    var rOuterCss = Math.max(rInnerCss, candidate.radiusOuter / dpr);

    ctx.save();
    ctx.rotate(candidate.phase);

    var zoomLineWidth = 1.5 / Math.max(worldZoom, 0.0001);
    ctx.lineWidth = zoomLineWidth;

    ctx.strokeStyle = 'rgba(0,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(0, 0, rOuterCss, gapStart, gapEnd);
    ctx.arc(0, 0, rInnerCss, gapEnd, gapStart, true);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    var lineInnerX = Math.cos(aRel) * rInnerCss;
    var lineInnerY = Math.sin(aRel) * rInnerCss;
    var lineOuterX = Math.cos(aRel) * rOuterCss;
    var lineOuterY = Math.sin(aRel) * rOuterCss;
    ctx.beginPath();
    ctx.moveTo(lineInnerX, lineInnerY);
    ctx.lineTo(lineOuterX, lineOuterY);
    ctx.stroke();

    ctx.restore();

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '12px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('idx: ' + idx + ' gap: ' + candidate.gapIndex, 10, 10);
    ctx.restore();
  }

  function computeTimescale(elapsed){
    if(TUNE.GLOBAL_SPEED_MODE === 'expo'){
      var minutes = Math.max(0, elapsed) / 60;
      var raw = Math.pow(TUNE.SPEEDUP_FACTOR_PER_MIN, minutes);
      if(!Number.isFinite(raw) || raw <= 0){ raw = 1; }
      var clamped = Math.min(raw, TUNE.MAX_SPEEDUP_FACTOR);
      return clamped > 0 ? clamped : 1;
    }
    return 1;
  }

  function updatePlayer(dt){
    var left = input.left();
    var right = input.right();
    var inputAxis = (right ? 1 : 0) - (left ? 1 : 0);
    var effectiveTurnSpeed = TUNE.PLAYER_TURN_SPEED_RAD_S * currentTimescale;
    player.velocity = inputAxis * effectiveTurnSpeed;
    player.angle = math.normAngle(player.angle + player.velocity * dt);

    if(inputAxis < 0){
      container.classList.add('tilt-left');
      container.classList.remove('tilt-right');
      tiltTimer = 0.12;
    } else if(inputAxis > 0){
      container.classList.add('tilt-right');
      container.classList.remove('tilt-left');
      tiltTimer = 0.12;
    } else {
      if(tiltTimer > 0){
        tiltTimer -= dt;
        if(tiltTimer <= 0){
          container.classList.remove('tilt-left');
          container.classList.remove('tilt-right');
        }
      }
    }
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

  function updateChecksum(){
    if(!Number.isFinite(survivalTime)){
      prepareReadyState();
      return;
    }
    var activeCount = 0;
    for(var i=0;i<ringPool.length;i++){
      if(ringPool[i].active){ activeCount++; }
    }
    checksum = ((activeCount << 3) ^ ((survivalTime * 17) | 0) ^ checksumSalt) >>> 0;
  }

  function render(){
    renderBackground(globalTime);
    ctx.save();
    ctx.translate(CENTER_X, CENTER_Y);
    var frameRotation = getFrameRotation();
    if(frameRotation !== 0){
      ctx.rotate(frameRotation);
    }
    var frameZoom = getFrameZoom();
    if(frameZoom !== 1){
      ctx.scale(frameZoom, frameZoom);
    }
    renderArenaPolygon();
    renderRings();
    renderDebugOverlay();
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
    currentTimescale = 1;
    nextBeatTime = Infinity;
    logicalSides = 6;
    displaySides = 6;
    previousSides = 6;
    targetSides = 6;
    morphTimer = 0;
    morphDuration = 0;
    worldSpinAngle = 0;
    worldZoom = 1;
    spinVelocity = 0;
    spinTimer = 0;
    checksumSalt = (math.randf() * 0xFFFFFFFF) >>> 0;
    checksum = 0;
    bannerTimer = 0;
    bannerActive = false;
    tiltTimer = 0;
    updateScoreLabel();
    container.classList.remove('tilt-left');
    container.classList.remove('tilt-right');
  }

  var PATTERN_BUILDERS = {
    spiralCW: function(lanes){
      var gap = math.randi(0, lanes - 1);
      var remaining = lanes + 6 + math.randi(0, 3);
      return {
        lanes: lanes,
        label: 'SPIRAL',
        tag: 'spiral-cw',
        baseSpeed: 150,
        telegraph: 0.32,
        next: function(){
          if(remaining-- <= 0){ return null; }
          var info = { gapIndex: gap };
          gap = (gap + 1) % lanes;
          return info;
        }
      };
    },
    spiralCCW: function(lanes){
      var gap = math.randi(0, lanes - 1);
      var remaining = lanes + 6 + math.randi(0, 3);
      return {
        lanes: lanes,
        label: 'SPIRAL',
        tag: 'spiral-ccw',
        baseSpeed: 150,
        telegraph: 0.32,
        next: function(){
          if(remaining-- <= 0){ return null; }
          var info = { gapIndex: gap };
          gap = (gap - 1 + lanes) % lanes;
          return info;
        }
      };
    },
    alternating: function(lanes){
      var step = math.randi(1, Math.max(1, Math.floor(lanes / 2)));
      var current = math.randi(0, lanes - 1);
      var direction = 1;
      var remaining = 8 + math.randi(0, 4);
      return {
        lanes: lanes,
        label: 'ALTERNATING',
        tag: 'alternating',
        baseSpeed: 160,
        telegraph: 0.34,
        next: function(){
          if(remaining-- <= 0){ return null; }
          var info = { gapIndex: current };
          current = (current + direction * step + lanes) % lanes;
          direction *= -1;
          return info;
        }
      };
    },
    pingPong: function(lanes){
      var length = Math.max(2, Math.min(lanes, math.randi(2, Math.floor(lanes / 2) + 1)));
      var start = math.randi(0, lanes - 1);
      var positions = [];
      for(var i=0;i<length;i++){ positions.push((start + i) % lanes); }
      var index = 0;
      var dir = 1;
      var remaining = length * 2 + 4 + math.randi(0, 3);
      return {
        lanes: lanes,
        label: 'PING PONG',
        tag: 'ping-pong',
        baseSpeed: 155,
        telegraph: 0.32,
        next: function(){
          if(remaining-- <= 0){ return null; }
          var info = { gapIndex: positions[index] };
          index += dir;
          if(index >= positions.length){ index = positions.length - 2; dir = -1; }
          else if(index < 0){ index = 1; dir = 1; }
          return info;
        }
      };
    },
    collapse: function(lanes){
      var gap = math.randi(0, lanes - 1);
      var remaining = 5 + math.randi(0, 3);
      var first = true;
      return {
        lanes: lanes,
        label: 'BARRAGE',
        tag: 'barrage',
        baseSpeed: 190,
        telegraph: 0.38,
        next: function(){
          if(remaining-- <= 0){ return null; }
          var info = { gapIndex: gap };
          if(first){
            info.telegraph = 0.45;
            first = false;
          } else {
            info.telegraph = 0.22;
          }
          return info;
        }
      };
    },
    flicker: function(lanes){
      var gap = math.randi(0, lanes - 1);
      var pendingShift = 0;
      var remaining = 6 + math.randi(0, 4);
      return {
        lanes: lanes,
        label: 'FLICKER',
        tag: 'flicker',
        baseSpeed: 165,
        telegraph: 0.3,
        next: function(){
          if(remaining-- <= 0){ return null; }
          if(pendingShift !== 0){
            gap = (gap + pendingShift + lanes) % lanes;
            pendingShift = 0;
          }
          var info = { gapIndex: gap };
          if(math.randf() < 0.28){
            pendingShift = math.randf() > 0.5 ? 1 : -1;
          }
          return info;
        }
      };
    },
    stream: function(lanes){
      var gap = math.randi(0, lanes - 1);
      var step = math.randi(1, Math.max(1, Math.floor(lanes / 3)));
      var remaining = lanes + 6 + math.randi(0, 4);
      return {
        lanes: lanes,
        label: 'STREAM/FAN',
        tag: 'stream',
        baseSpeed: 210,
        telegraph: 0.18,
        next: function(){
          if(remaining-- <= 0){ return null; }
          var info = { gapIndex: gap, telegraph: 0.18 };
          gap = (gap + step) % lanes;
          return info;
        }
      };
    },
    doubleWall: function(lanes){
      var gap = math.randi(0, lanes - 1);
      var even = (lanes % 2) === 0;
      var half = even ? lanes / 2 : Math.floor(lanes / 2);
      var remaining = 4 + math.randi(0, 3);
      return {
        lanes: lanes,
        label: 'DOUBLE WALL',
        tag: 'double-wall',
        baseSpeed: 170,
        telegraph: 0.36,
        next: function(){
          if(remaining-- <= 0){ return null; }
          var gaps = [gap];
          if(even){
            var opposite = (gap + half) % lanes;
            if(opposite !== gap){ gaps.push(opposite); }
          }
          var info = { gapIndex: gap, gapIndices: gaps };
          var shift = even ? math.randi(1, Math.max(1, Math.floor(half - 1))) : math.randi(1, Math.max(1, half));
          if(!Number.isFinite(shift) || shift <= 0){ shift = 1; }
          gap = (gap + shift) % lanes;
          return info;
        }
      };
    }
  };

  var PATTERN_SEQUENCE = Object.keys(PATTERN_BUILDERS);
  var lastPatternName = '';

  var patternManager = (function(){
    var activePattern = null;

    function cloneSpawn(spawn){
      var info = {};
      for(var key in spawn){
        if(Object.prototype.hasOwnProperty.call(spawn, key)){
          info[key] = spawn[key];
        }
      }
      return info;
    }

    function pickPattern(){
      var lanes = Math.max(3, Math.round(logicalSides));
      var candidates = PATTERN_SEQUENCE.slice();
      if(lastPatternName && candidates.length > 1){
        var lastIdx = candidates.indexOf(lastPatternName);
        if(lastIdx !== -1){ candidates.splice(lastIdx, 1); }
      }
      while(candidates.length > 0){
        var pickIdx = math.randi(0, candidates.length - 1);
        var key = candidates.splice(pickIdx, 1)[0];
        var builder = PATTERN_BUILDERS[key];
        if(typeof builder !== 'function'){ continue; }
        var pattern = builder(lanes);
        if(!pattern || typeof pattern.next !== 'function'){ continue; }
        if(typeof pattern.lanes !== 'number'){ pattern.lanes = lanes; }
        if(typeof pattern.baseSpeed !== 'number'){ pattern.baseSpeed = 150; }
        if(typeof pattern.telegraph !== 'number'){ pattern.telegraph = 0.3; }
        pattern.key = key;
        return pattern;
      }
      return null;
    }

    function ensurePattern(){
      if(!activePattern){
        activePattern = pickPattern();
      }
    }

    function finalizeSpawn(spawn){
      var info = cloneSpawn(spawn);
      var lanes = info.laneCount === undefined ? (activePattern && activePattern.lanes) : info.laneCount;
      if(lanes === undefined){ lanes = Math.max(3, Math.round(logicalSides)); }
      info.laneCount = lanes;
      var baseSpeed = typeof info.speed === 'number' ? info.speed : (activePattern ? activePattern.baseSpeed : 150);
      info.speed = baseSpeed;
      if(typeof info.telegraph !== 'number'){
        info.telegraph = activePattern ? activePattern.telegraph : 0.3;
      }
      info.patternTag = info.patternTag || (activePattern ? activePattern.tag : 'base');
      if(Array.isArray(info.gapIndices)){
        info.gapIndices = info.gapIndices.slice();
      }
      return info;
    }

    function pullNextSpawn(){
      var guard = 0;
      while(guard++ < 32){
        ensurePattern();
        if(!activePattern){ return null; }
        var spawn = activePattern.next();
        if(spawn){
          return finalizeSpawn(spawn);
        }
        lastPatternName = activePattern.key || '';
        activePattern = null;
      }
      return null;
    }

    return {
      reset: function(){
        activePattern = null;
        lastPatternName = '';
      },
      start: function(){
        activePattern = null;
      },
      nextSpawn: function(){
        return pullNextSpawn();
      }
    };
  })();

  function resetBeatClock(startTime){
    var base = Number.isFinite(startTime) ? startTime : 0;
    var interval = Math.max(0.01, TUNE.SPAWN_INTERVAL_S);
    nextBeatTime = base + interval;
  }

  function spawnOnBeat(){
    var spec = patternManager.nextSpawn();
    if(!spec){ return false; }
    spawnRing(spec);
    audio.playTick();
    return true;
  }

  function runBeatClock(runTime){
    var interval = Math.max(0.01, TUNE.SPAWN_INTERVAL_S);
    if(!Number.isFinite(nextBeatTime)){ nextBeatTime = runTime + interval; }
    var guard = 0;
    while(runTime + 1e-6 >= nextBeatTime && guard++ < 32){
      if(!spawnOnBeat()){
        nextBeatTime = runTime + interval;
        break;
      }
      nextBeatTime += interval;
    }
  }

  function setState(next){
    state = next;
  }

  function prepareReadyState(){
    resetRunData();
    patternManager.reset();
    hideOverlay();
    showBanner('READY');
    setState('READY');
    isStarting = false;
    colorIndex = 0;
    prevMovementIntent = input.left() || input.right();
  }

  function startRun(){
    if(state !== 'READY' || isStarting){ return; }
    isStarting = true;
    audio.ensure();
    hideOverlay();
    patternManager.start();
    resetBeatClock(survivalTime);
    setState('RUN');
    isStarting = false;
  }

  function gameOver(){
    if(state !== 'RUN'){ return; }
    audio.playHit();
    audio.playDeath();
    container.classList.add('shake');
    window.setTimeout(function(){ container.classList.remove('shake'); }, 120);
    showOverlay('GAME OVER');
    if(playAgain){
      try { playAgain.focus({ preventScroll: true }); } catch(_e){}
    }
    nextBeatTime = Infinity;
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
    currentTimescale = computeTimescale(survivalTime);
    updateScoreLabel();
    runBeatClock(survivalTime);
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
    handleMuteInput();
    pollStartIntent();
    var movementIntent = input.left() || input.right();
    if(state === 'READY' && movementIntent && !prevMovementIntent){
      startRun();
      if(state === 'RUN'){
        audio.playStart();
      }
    }
    prevMovementIntent = movementIntent;

    if(state === 'RUN'){
      updateRun(dt);
    } else if(state === 'READY'){
      updateReady(dt);
    } else if(state === 'GAME_OVER'){
      updateGameOver(dt);
    }
  }

  function applyScaling(){
    var prevDpr = dpr;
    var nextDpr = window.devicePixelRatio || 1;
    if(!Number.isFinite(prevDpr) || prevDpr <= 0){ prevDpr = nextDpr; }
    if(!Number.isFinite(nextDpr) || nextDpr <= 0){ nextDpr = 1; }
    dpr = nextDpr;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var scale = dpr / prevDpr;
    if(scale !== 1){
      for(var i=0;i<ringPool.length;i++){
        var ring = ringPool[i];
        ring.radiusOuter *= scale;
        ring.thickness *= scale;
        ring.radiusInner = ring.radiusOuter - ring.thickness;
        ring.baseSpeedPxPerS *= scale;
      }
    }

    refreshArenaMetrics();
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

  function deepFreeze(obj){
    if(!obj || typeof obj !== 'object'){ return obj; }
    var props = Object.getOwnPropertyNames(obj);
    for(var i=0;i<props.length;i++){
      var value = obj[props[i]];
      if(value && typeof value === 'object' && !Object.isFrozen(value)){
        deepFreeze(value);
      }
    }
    return Object.freeze(obj);
  }

  deepFreeze(root);
})();
