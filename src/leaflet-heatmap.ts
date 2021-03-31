import h337 from 'heatmap.js';
import { Layer, Map, LayerGroup } from 'leaflet';

export class HeatmapOverlay extends Layer {
    public cfg: any;
    public _el: any;
    public _data: any;
    public _max: any;
    public _min: any;
    public _map: any;
    public _width: any;
    public _height: any;
    public _origin: any;
    public _heatmap: any;

      constructor(cconfig: any) {
        super();
        this.cfg = cconfig;
        this._el = L.DomUtil.create('div', 'leaflet-zoom-hide');
        this._data = [];
        this._max = 1;
        this._min = 0;
        this.cfg.container = this._el;
      }
  
      public onAdd(map: Map): this {
        var size = map.getSize();
  
        this._map = map;
  
        this._width = size.x;
        this._height = size.y;
  
        this._el.style.width = size.x + 'px';
        this._el.style.height = size.y + 'px';
        this._el.style.position = 'absolute';
  
        this._origin = this._map.layerPointToLatLng(new L.Point(0, 0));
  
        map.getPanes().overlayPane.appendChild(this._el);
  
        if (!this._heatmap) {
          this._heatmap = h337.create(this.cfg);
        } 
  
        // this resets the origin and redraws whenever
        // the zoom changed or the map has been moved
        map.on('moveend', this._reset, this);
        this._draw();

        return this;
      }
  
      public addTo(map: Map|LayerGroup): this {
        map.addLayer(this);
        return this;
      }
  
      public onRemove(map: Map): this {
        // remove layer's DOM elements and listeners
        map.getPanes().overlayPane.removeChild(this._el);
        map.off('moveend', this._reset, this);
        return this;
      }

      private _draw() {
        if (!this._map) { return; }
        
        var mapPane = this._map.getPanes().mapPane;
        var point = mapPane._leaflet_pos;      
  
        // reposition the layer
        this._el.style.transform = 'translate(' +
          -Math.round(point.x) + 'px,' +
          -Math.round(point.y) + 'px)';
  
        this._update();
      }

      private _update() {
        var bounds, zoom, scale;
        var generatedData = { max: this._max, min: this._min, data: new Array() };
  
        bounds = this._map.getBounds();
        zoom = this._map.getZoom();
        scale = Math.pow(2, zoom);
  
        if (this._data.length == 0) {
          if (this._heatmap) {
            this._heatmap.setData(generatedData);
          }
          return;
        }
  
        var latLngPoints = [];
        var radiusMultiplier = this.cfg.scaleRadius ? scale : 1;
        var localMax = 0;
        var localMin = 0;
        var valueField = this.cfg.valueField;
        var len = this._data.length;
      
        while (len--) {
          var entry = this._data[len];
          var value = entry[valueField];
          var latlng = entry.latlng;
  
  
          // we don't wanna render points that are not even on the map ;-)
          if (!bounds.contains(latlng)) {
            continue;
          }
          // local max is the maximum within current bounds
          localMax = Math.max(value, localMax);
          localMin = Math.min(value, localMin);
  
          var point = this._map.latLngToContainerPoint(latlng);
          var latlngPoint: any = { x: Math.round(point.x), y: Math.round(point.y) };
          latlngPoint[valueField] = value;
  
          var radius;
  
          if (entry.radius) {
            radius = entry.radius * radiusMultiplier;
          } else {
            radius = (this.cfg.radius || 2) * radiusMultiplier;
          }
          latlngPoint.radius = radius;
          latLngPoints.push(latlngPoint);
        }
        if (this.cfg.useLocalExtrema) {
          generatedData.max = localMax;
          generatedData.min = localMin;
        }
  
        generatedData.data = latLngPoints;
  
        this._heatmap.setData(generatedData);
      }
      
      public setData(data: any) {
        this._max = data.max || this._max;
        this._min = data.min || this._min;
        var latField = this.cfg.latField || 'lat';
        var lngField = this.cfg.lngField || 'lng';
        var valueField = this.cfg.valueField || 'value';
      
        // transform data to latlngs
        var data = data.data;
        var len = data.length;
        var d = [];
      
        while (len--) {
          var entry = data[len];
          var latlng = new L.LatLng(entry[latField], entry[lngField]);
          var dataObj: any = { latlng: latlng };
          dataObj[valueField] = entry[valueField];
          if (entry.radius) {
            dataObj.radius = entry.radius;
          }
          d.push(dataObj);
        }
        this._data = d;
      
        this._draw();
      }

      // experimential... not ready.
      public addData(pointOrArray: any) {
        if (pointOrArray.length > 0) {
          var len = pointOrArray.length;
          while(len--) {
            this.addData(pointOrArray[len]);
          }
        } else {
          var latField = this.cfg.latField || 'lat';
          var lngField = this.cfg.lngField || 'lng';
          var valueField = this.cfg.valueField || 'value';
          var entry = pointOrArray;
          var latlng = new L.LatLng(entry[latField], entry[lngField]);
          var dataObj: any = { latlng: latlng };
          
          dataObj[valueField] = entry[valueField];
          this._max = Math.max(this._max, dataObj[valueField]);
          this._min = Math.min(this._min, dataObj[valueField]);
  
          if (entry.radius) {
            dataObj.radius = entry.radius;
          }
          this._data.push(dataObj);
          this._draw();
        }
      }

      public _reset() {
        this._origin = this._map.layerPointToLatLng(new L.Point(0, 0));
        
        var size = this._map.getSize();
        if (this._width !== size.x || this._height !== size.y) {
          this._width  = size.x;
          this._height = size.y;
  
          this._el.style.width = this._width + 'px';
          this._el.style.height = this._height + 'px';
  
          this._heatmap._renderer.setDimensions(this._width, this._height);
        }
        this._draw();
      }
    }