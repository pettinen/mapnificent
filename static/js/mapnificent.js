/* globals $, Quadtree, console, L, dcodeIO */

(function(){
'use strict';

function getProgressBar(percent) {
  return $('<div class="progress">' +
    '<div class="progress-bar progress-bar-mapnificent"  role="progressbar" aria-valuenow="' + percent + '" aria-valuemin="0" aria-valuemax="100" style="width: ' + percent + '%">' +
    '<span class="sr-only">' + percent + '% Complete</span>' +
  '</div></div>');
}

function updateProgressBar(progressBar, percent) {
  progressBar.find('.progress-bar').attr({
    'aria-valuenow': percent,
    style: 'width: ' + percent + '%'
  });
  progressBar.find('.sr-only').text(percent + '% Complete');
}

function MapnificentPosition(mapnificent, latlng, time) {
  this.mapnificent = mapnificent;
  this.latlng = latlng;
  this.stationMap = null;
  this.progress = 0;
  this.time = time === undefined ? 15 * 60 : time;
  this.init();
}

MapnificentPosition.prototype.init = function () {
  this.marker = L.marker(this.latlng, {
    draggable: true,
    opacity: 0.5
  });
  this.popup = L.popup({
    minWidth: 200
  });
  this.marker
    .bindPopup(this.popup)
    .addTo(this.mapnificent.map);
  this.marker.on('dragend', () => {
    this.updatePosition(this.marker.getLatLng());
  });
  this.startCalculation();
};

MapnificentPosition.prototype.updatePosition = function (latlng, time) {
  let needsRedraw = false, needsRecalc = false;
  if (time !== undefined) {
    if (time !== this.time) {
      needsRedraw = true;
    }
    this.time = time;
  }
  if (this.latlng.lat !== latlng.lat || this.latlng.lng !== latlng.lng) {
    needsRecalc = true;
    needsRedraw = true;
  }
  this.latlng = latlng;
  if (needsRecalc) {
    this.marker.setLatLng(this.latlng);
    this.stationMap = null;
    this.progress = 0;
    this.startCalculation();
    this.marker.openPopup();
  }
  if (needsRedraw) {
    this.mapnificent.redraw();
  }
  if (needsRedraw || needsRecalc) {
    this.mapnificent.triggerHashUpdate();
  }
};

MapnificentPosition.prototype.updateProgress = function (percent) {
  let addClass = '';
  if (percent === undefined) {
    var max = this.mapnificent.settings.options.estimatedMaxCalculateCalls || 100000;
    percent = this.progress / max * 100;
    if (percent > 99) {
      percent = 99;
      addClass = 'progress-striped active';
    }
  }
  this.marker.setOpacity(Math.max(0.5, percent / 100));
  $(this.popup.getContent()).find('.progress').addClass(addClass);
  updateProgressBar($(this.popup.getContent()), percent);
  this.popup.update();
};


MapnificentPosition.prototype.renderProgress = function() {
  const div = $('<div class="position-control">');
  var percent = 0;
  var progressBar = getProgressBar(percent);
  div.append(progressBar);
  var removeSpan = $('<span class="position-remove glyphicon glyphicon-trash pull-right">').on('click', () => {
    this.mapnificent.removePosition(this);
  });

  div.append(removeSpan);
  this.popup.setContent(div[0]);
};

MapnificentPosition.prototype.setTime = function(time) {
  if (time !== this.time) {
    this.time = time;
    this.mapnificent.redraw();
    this.mapnificent.triggerHashUpdate();
  }
};

MapnificentPosition.prototype.updateControls = function(){
  const self = this;
  const div = $('<div class="position-control">');
  const minutesTime = Math.round(this.time / 60);
  const input = $('<input type="range">').attr({
    max: Math.round(this.mapnificent.settings.options.maxWalkTravelTime / 60),
    min: 0,
    value: minutesTime
  }).on('change', function() {
    self.setTime(parseInt($(this).val()) * 60);
  }).on('mousemove keyup touchmove touchend', function() {
    $(self.popup.getContent()).find('.time-display').text($(this).val() + ' min');
    if (self.mapnificent.settings.redrawOnTimeDrag) {
      self.setTime(parseInt($(this).val()) * 60);
    }
  });

  div.append(input);

  const timeSpan = $('<div class="pull-left">' +
    '<span class="glyphicon glyphicon-time"></span> ' +
     '<span class="time-display">' + minutesTime + ' min</span></div>');
  div.append(timeSpan);

  const removeSpan = $('<span class="position-remove glyphicon glyphicon-trash pull-right">').on('click', function() {
    self.mapnificent.removePosition(self);
  });

  div.append(removeSpan);
  this.popup.setContent(div[0]);
};

MapnificentPosition.prototype.createWorker = function () {
  if (this.webworker) {
    return this.webworker;
  }
  this.webworker = new window.Worker(
    `${this.mapnificent.settings.baseurl}/static/js/mapnificentworker.js`,
  );
  this.webworker.onmessage = this.workerMessage();
  this.webworker.onerror = this.workerError;
};

MapnificentPosition.prototype.workerMessage = function () {
  return (event) => {
    if (event.data.status === 'working') {
      this.progress = event.data.at;
      this.updateProgress();
    } else if (event.data.status === 'done') {
      console.log('Count loops', event.data.count);
      this.updateProgress(100);
      this.updateControls();
      this.stationMap = event.data.stationMap;
      this.debugMap = event.data.debugMap;
      this.mapnificent.redraw();
    }
  };
};

MapnificentPosition.prototype.workerError = function () {
  return function (event) {
    console.error('error', event);
  };
};

MapnificentPosition.prototype.startCalculation = function () {
  this.renderProgress();
  this.marker.openPopup();
  this.createWorker();
  this.webworker.postMessage({
      lat: this.latlng.lat,
      lng: this.latlng.lng,
      // fromStations: nextStations.map(function(m){ return m[0].id; }),
      stations: this.mapnificent.stationList,
      lines: this.mapnificent.lines,
      // distances: nextStations.map(function(m){ return m[1] / 1000; }),
      reportInterval: 5000,
      intervalKey: this.mapnificent.settings.intervalKey,
      maxWalkTime: this.mapnificent.settings.maxWalkTime,
      secondsPerM: this.mapnificent.settings.secondsPerKm / 1000,
      searchRadius: this.mapnificent.settings.initialStationSearchRadius,
      bounds: this.mapnificent.settings.bounds,
      debug: this.mapnificent.settings.debug,
  });
};

MapnificentPosition.prototype.getReachableStations = function(stationsAround, start, tileSize, zoom) {
  const getLngRadius = function (lat, mradius) {
    const equatorLength = 40_075_017;
    const hLength = equatorLength * Math.cos(lat * Math.PI / 180);

    return (mradius / hLength) * 360;
  };

  const maxWalkTime = this.mapnificent.settings.maxWalkTime;
  const secondsPerKm = this.mapnificent.settings.secondsPerKm;

  const convert = (station, reachableIn) => {
    const secs = Math.min((this.time - reachableIn), maxWalkTime);
    const mradius = secs * (1 / secondsPerKm) * 1000;

    const point = L.latLng(station.lat, station.lng);

    const lngRadius = getLngRadius(station.lat, mradius);
    const latlng2 = L.latLng(station.lat, station.lng - lngRadius);
    const point2 = this.mapnificent.map.latLngToLayerPoint(latlng2);

    const lpoint = this.mapnificent.map.latLngToLayerPoint(point);
    const radius = Math.max(Math.round(lpoint.x - point2.x), 1);

    const p = this.mapnificent.map.project(point, zoom);
    const x = Math.round(p.x - start.x);
    const y = Math.round(p.y - start.y);
    if (x + radius < 0 || x - radius > tileSize.x ||
        y + radius < 0 || y - radius > tileSize.y) {
      return null;
    }
    return { x, y, r: radius };
  };

  const stations = [];

  if (this.stationMap === null) {
    return stations;
  }

  // You start walking from your position
  let station = convert(this.latlng, 0);
  if (station !== null) {
    stations.push(station);
  }

  for (const nearbyStation of stationsAround) {
    const stationTime = this.stationMap[nearbyStation.id];
    if (stationTime === undefined || stationTime >= this.time) {
      continue;
    }

    station = convert(nearbyStation, stationTime);
    if (station !== null) {
      stations.push(station);
    }
  }
  return stations;
};

MapnificentPosition.prototype.destroy = function(){
  this.mapnificent.map.closePopup(this.popup);
  this.mapnificent.map.removeLayer(this.popup);
  this.mapnificent.map.removeLayer(this.marker);
  this.webworker.terminate();
  this.webworker = null;
  this.stationMap = null;
  this.marker = null;
  this.popup = null;
  this.redrawTime = 0;
};

function Mapnificent(map, city, pageConfig){
  this.map = map;
  this.positions = [];
  // FIXME: this is messy
  this.city = city;
  this.settings = $.extend({
    intervalKey: '1-6',
    baseurl: '/',
    maxWalkTime: 15 * 60,
    // Slow walking speed (3 km/h) to compensate for
    // as-the-crow-flies distances and general optimism
    secondsPerKm: 3600 / 3,
    initialStationSearchRadius: 1000,
    redrawOnTimeDrag: false,
    debug: window.location.search.indexOf("debug") !== -1,
  }, city);
  this.settings.options = $.extend({
    maxWalkTravelTime: 1.5 * 60 * 60,
  }, this.settings.options)
  this.settings = $.extend(this.settings, pageConfig);
}

Mapnificent.prototype.init = function(){
  let t0;
  this.tilesLoading = false;

  return this.loadData().done((data) => {
    this.prepareData(data);
    this.canvasTileLayer = this.makeCanvasLayer();
    this.canvasTileLayer.on('loading', () => {
      this.tilesLoading = true;
      t0 = new Date().getTime();
    });
    this.canvasTileLayer.on('load', () => {
      this.tilesLoading = false;
      if (this.needsRedraw) {
        this.redraw();
      }
      this.redrawTime = (new Date().getTime()) - t0;
      console.log('reloading tile layer took', this.redrawTime, 'ms');
    });

    this.map.addLayer(this.canvasTileLayer);
    this.map.on('click', (e) => {
      this.addPosition(e.latlng);
    });

    if (this.settings.debug) {
      this.map.on('contextmenu', (e) => {
        this.logDebugMessage(e.latlng);
      });
    }

    this.setupHash();

    if (this.settings.coordinates) {
      this.hash.updateHash();
      if (this.positions.length === 0) {
        this.addPosition(L.latLng(
          this.settings.coordinates[1],
          this.settings.coordinates[0]
        ));
      }
    }
  });
};

Mapnificent.prototype.logDebugMessage = function(latlng) {
  var self = this;
  var stationsAround = this.quadtree.searchInRadius(latlng.lat, latlng.lng, 300);
  this.positions.forEach(function(pos, i){
    console.log('Position ', i);
    if (pos.debugMap === undefined) {
      console.log('No debug map present');
    }
    stationsAround.forEach(function(station, j){
      var lastTransport;
      console.log('Found station', station.Name);
      if (pos.debugMap[station.id] === undefined) {
        console.log('Not reached');
        return;
      }
      var totalTime = 0
      pos.debugMap[station.id].forEach(function(stop, k){
        var fromName = '$walking'
        var distance
        var toStop = self.stationList[stop.to]
        if (stop.from !== -1) {
          var fromStop = self.stationList[stop.from]
          fromName = fromStop.Name
          distance = self.quadtree.distanceBetweenCoordinates(
            fromStop.Latitude, fromStop.Longitude,
            toStop.Latitude, toStop.Longitude
          )
        }
        if (lastTransport != stop.line) {
          console.log(k, 'Switching transport to', self.lineNames[stop.line],
                      'waiting: ', stop.waittime);
        }
        lastTransport = stop.line;
        var currentTime = stop.time - totalTime;
        totalTime = stop.time;
        console.log(k, fromName, '->',
                    toStop.Name,
                    'via', self.lineNames[stop.line],
                    'in', currentTime,
                    ' (' +
                    'stay: ' + stop.stay +
                    ', total time: ' + stop.time +
                    ', total walk time: ' + stop.walkTime +
                    ', distance: ' + distance +' meters)');
      });
    });
  });
};

Mapnificent.prototype.loadData = function(){
  const dataUrl = `${this.settings.baseurl}/${this.settings.cityid}/${this.settings.cityid}${this.settings.debug ? '__debug' : ''}.bin`;

  const MAPNIFICENT_PROTO = {"nested":{"mapnificent":{"nested":{"MapnificentNetwork":{"fields":{"Cityid":{"type":"string","id":1},"Stops":{"rule":"repeated","type":"Stop","id":2},"Lines":{"rule":"repeated","type":"Line","id":3}},"nested":{"Stop":{"fields":{"Latitude":{"type":"double","id":1},"Longitude":{"type":"double","id":2},"TravelOptions":{"rule":"repeated","type":"TravelOption","id":3},"Name":{"type":"string","id":4}},"nested":{"TravelOption":{"fields":{"Stop":{"type":"uint32","id":1},"TravelTime":{"type":"uint32","id":2},"StayTime":{"type":"uint32","id":3},"Line":{"type":"string","id":4},"WalkDistance":{"type":"uint32","id":5}}}}},"Line":{"fields":{"LineId":{"type":"string","id":1},"LineTimes":{"rule":"repeated","type":"LineTime","id":2},"Name":{"type":"string","id":3}},"nested":{"LineTime":{"fields":{"Interval":{"type":"uint32","id":1},"Start":{"type":"uint32","id":2},"Stop":{"type":"uint32","id":3},"Weekday":{"type":"uint32","id":4}}}}}}}}}}};

  const protoRoot = protobuf.Root.fromJSON(MAPNIFICENT_PROTO);

  const d = $.Deferred();

  const loadProgress = $('#load-progress');
  const progressBar = getProgressBar(0.0);
  loadProgress.find('.modal-body').html(progressBar);
  loadProgress.modal('show');

  const oReq = new XMLHttpRequest();
  oReq.open("GET", dataUrl, true);
  oReq.responseType = "arraybuffer";

  oReq.onload = function(oEvent) {
    const MapnificentNetwork = protoRoot.lookupType('mapnificent.MapnificentNetwork');
    console.log('received binary', new Date().getTime());
    const message = MapnificentNetwork.decode(new Uint8Array(oEvent.target.response));
    console.log('decoded message', new Date().getTime());
    loadProgress.modal('hide');
    d.resolve(message);
  };
  oReq.addEventListener("progress", function updateProgress (oEvent) {
    if (oEvent.lengthComputable) {
      const percentComplete = oEvent.loaded / oEvent.total * 100;
      updateProgressBar(loadProgress, percentComplete);
    } else {
      updateProgressBar(loadProgress, 100);
      loadProgress.find('.progress').addClass('active progress-striped');
    }
  });

  oReq.send();
  return d;
};

Mapnificent.prototype.getLineTimesByInterval = function(lineTimes) {
  return Object.fromEntries(
    lineTimes.map((time) => [`${time.Weekday}-${time.Start}`, time.Interval])
  );
}

Mapnificent.prototype.prepareData = function(data) {
  this.stationList = data.Stops;
  this.lines = {};
  this.lineNames = {};
  let selat = Infinity, nwlat = -Infinity, nwlng = Infinity, selng = -Infinity;

  for (let i = 0; i < this.stationList.length; i += 1){
    this.stationList[i].id = i;
    this.stationList[i].lat = data.Stops[i].Latitude;
    this.stationList[i].lng = data.Stops[i].Longitude;
    selat = Math.min(selat, this.stationList[i].lat);
    nwlat = Math.max(nwlat, this.stationList[i].lat);
    selng = Math.max(selng, this.stationList[i].lng);
    nwlng = Math.min(nwlng, this.stationList[i].lng);
  }

  for (let i = 0; i < data.Lines.length; i += 1) {
    if (!data.Lines[i].LineTimes[0]) { continue; }
    this.lines[data.Lines[i].LineId] = this.getLineTimesByInterval(data.Lines[i].LineTimes);
    if (this.settings.debug) {
      this.lineNames[data.Lines[i].LineId] = data.Lines[i].Name;
    }
  }
  const b = 0.01;
  this.settings.bounds = [selat - b, nwlat + b, nwlng - b, selng + b];
  this.quadtree = Quadtree.create(
    this.settings.bounds[0], this.settings.bounds[1],
    this.settings.bounds[2], this.settings.bounds[3]
  );
  this.quadtree.insertAll(this.stationList);
};

Mapnificent.prototype.redraw = function () {
  this.needsRedraw = true;
  if (this.canvasTileLayer) {
    if (this.tilesLoading) {
      return;
    }
    L.Util.requestAnimFrame(() => {
      this.needsRedraw = false;
      this.canvasTileLayer.redraw();
    });
  }
};

Mapnificent.prototype.addPosition = function(latlng, time){
  this.positions.push(new MapnificentPosition(this, latlng, time));
  this.triggerHashUpdate();
};

Mapnificent.prototype.removePosition = function(pos) {
  this.positions = this.positions.filter((p) => p !== pos);
  pos.destroy();
  this.redraw();
  this.triggerHashUpdate();
};

Mapnificent.prototype.triggerHashUpdate = function () {
  if (!this.hash) {
    return;
  }
  const zoom = this.map.getZoom();
  const precision = Math.max(0, Math.ceil(Math.log(zoom) / Math.LN2));

  this.hash.setHashMeta(this.positions.flatMap((pos) => [
    pos.time,
    pos.latlng.lat.toFixed(precision),
    pos.latlng.lng.toFixed(precision),
  ]));
}

Mapnificent.prototype.makeCanvasLayer = function () {
  const mapnificent = this;
  const map = this.map;
  const maxWalkDistance = 1000 * this.settings.maxWalkTime / this.settings.secondsPerKm;

  const Layer = L.GridLayer.extend({
    createTile(tilePoint) {
      const tileSize = this.getTileSize();
      const canvas = L.DomUtil.create('canvas', 'leaflet-tile');
      canvas.width = tileSize.x;
      canvas.height = tileSize.y;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!mapnificent.stationList || mapnificent.positions.length === 0) {
        return canvas;
      }
      const zoom = tilePoint.z;
      const start = tilePoint.scaleBy(tileSize);
      const startLatLng = map.unproject(start, zoom);
      const end = start.add(tileSize);
      const endLatLng = map.unproject(end, zoom);
      const span = startLatLng.distanceTo(endLatLng);
      const middle = start.add(tileSize.divideBy(2));
      const latlng = map.unproject(middle, zoom);

      const searchRadius = Math.sqrt(2 * span * span) + maxWalkDistance;
      const stationsAround = mapnificent.quadtree.searchInRadius(
          latlng.lat,
          latlng.lng,
          searchRadius,
      );

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(50, 50, 50, 0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgb(0, 0, 0)';
      for (const pos of mapnificent.positions) {
        const stations = pos.getReachableStations(
          stationsAround,
          start,
          tileSize,
          zoom
        );
        for (const station of stations) {
          ctx.beginPath();
          ctx.arc(station.x, station.y, station.r, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      return canvas;
    },
  });
  return new Layer();
};

Mapnificent.prototype.setupHash = function() {
  const metaFloatRegex = /^-?\d+\.\d+$/;
  const metaIntRegex = /^\d+$/;

  const getMetaValue = (value, type) => {
    let regex, validate;
    if (type === "coordinate") {
      regex = metaFloatRegex;
      validate = Number.isFinite;
    } else if (type === "time") {
      regex = metaIntRegex;
      validate = Number.isSafeInteger;
    } else {
      throw new ValueError("invalid `type` parameter");
    }

    if (typeof value !== "string" || !regex.exec(value)) {
      return null;
    }
    const num = Number(value);
    return validate(num) ? num : null;
  };

  const updatePositions = ({ meta }) => {
    if (!Array.isArray(meta)) {
      return;
    }
    let i;
    for (i = 0;; i += 1) {
      const time = getMetaValue(meta[3 * i], "time");
      const lat = getMetaValue(meta[3 * i + 1], "coordinate");
      const lng = getMetaValue(meta[3 * i + 2], "coordinate");
      if (time === null || lat === null || lng === null) {
        break;
      }
      const pos = [L.latLng(lat, lng), time];
      if (this.positions[i] === undefined) {
        this.addPosition(...pos);
      } else {
        this.positions[i].updatePosition(...pos);
      }
    }
    for (let j = i; j < this.positions.length; j += 1) {
      this.removePosition(this.positions[j]);
    }
  };
  this.map.on("hashmetainit", updatePositions);
  this.map.on("hashmetachange", updatePositions);
  this.hash = L.hash(this.map);
};

// onMapMove: function() {
//   // bail if we're moving the map (updating from a hash),
//   // or if the map is not yet loaded
//
//   if (this.movingMap || !this.map._loaded) {
//     return false;
//   }
//
//   var hash = this.formatHash(this.map);
//   if (this.lastHash != hash) {
//     location.replace(hash);
//     this.lastHash = hash;
//   }
// },

window.Mapnificent = Mapnificent;

}());
