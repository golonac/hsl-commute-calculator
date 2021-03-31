import 'bootstrap-css';
import * as Leaflet from 'leaflet';
import { DateTime, Duration } from 'luxon';
import './style.css';
import 'leaflet/dist/leaflet.css';
import './fix-leaflet-markers';
import 'heatmap.js';
import { HeatmapOverlay } from './leaflet-heatmap';
import pool from '@ricokahler/pool';

interface TravelDurationResult extends h337.DataPoint<'value', 'lat', 'lng'> {
}

interface PointGenerationResult {
  tileX: number;
  tileY: number;
  worldPosition: Leaflet.LatLng;
}

class TravelDurationMap {
  // How many HSL API queries should be made simultaneously
  public numSimultaneousHslApiQueries = 40;

  // The latitudinal arc of the search area
  public heatmapTileSize: number = .6;

  // The number of data points that will be queried in each of the 2 dimensions, total points = (value * 2 + 1) ^ 2
  public halfHeatmapDataPointsPerDimension = 50;

  // The longest travel duration that can be displayed (values are clipped beyond it)
  public maxTravelDurationInMinutes = 90;

  // The world size of the search area
  private get heatmapWorldSize(): Leaflet.LatLng {
    return new Leaflet.LatLng(this.heatmapTileSize, this.heatmapTileSize * 2);
  }

  // The world size of a single data point in GCS degrees
  private get heatmapDataPointWorldSize(): Leaflet.LatLng {
    return new Leaflet.LatLng(this.heatmapWorldSize.lat / (this.halfHeatmapDataPointsPerDimension * 2 + 1), this.heatmapWorldSize.lng / (this.halfHeatmapDataPointsPerDimension * 2 + 1));
  }

  private readonly map: Leaflet.Map;
  private marker: Leaflet.Marker;
  private heatmap: HeatmapOverlay;
  private currentRoutingOperationAbortController: AbortController;
  private currentRoutingTo: Leaflet.LatLng;
  private routeTime: string = '08:00';

  constructor() {
    // Setup controls on page
    this.setupPageControls();

    // Initialize OpenStreetMap, heatmap overlay and markers
    this.map = Leaflet.map('map').setView([60.2299, 24.8912], 11);
    Leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);
    this.map.on('click', (evt: Leaflet.LeafletMouseEvent) => this.mapClicked(evt.latlng));

    // Place the routing marker to initial position
    const initialPosition: Leaflet.LatLng = new Leaflet.LatLng(60.167070, 24.939650);
    this.marker = Leaflet.marker(initialPosition).addTo(this.map);
    this.currentRoutingTo = initialPosition;

    // Setup heatmap and routing
    this.setupRouting();
  }

  private setupPageControls() {
    document.getElementById('durationLegendMin').innerText = `0min`;
    document.getElementById('durationLegendMax').innerText = `${this.maxTravelDurationInMinutes}min`;

    // Setup route number of data points selector input
    const numDataPointsInput = document.getElementById('numDataPointsInput');
    (numDataPointsInput as any).value = this.halfHeatmapDataPointsPerDimension;
    numDataPointsInput.onchange = evt => {
      this.halfHeatmapDataPointsPerDimension = parseInt((evt.target as any).value);
      this.setupRouting();
    };
    
    // Setup route time selector input
    const timeInput = document.getElementById('timeInput');
    timeInput.onchange = evt => {
      const timeString = (evt.target as any).value;
      const todayAtRouteHour = DateTime.fromFormat(timeString, "hh:mm");
      if (!(todayAtRouteHour as any).invalid) {
        this.routeTime = timeString;
        this.setupRouting();
      }
    };
    (timeInput as any).value = this.routeTime;
  }

  private setupRouting() {
    // If a new routing operation was requested, remove the old heatmap
    if (this.heatmap) this.map.removeLayer(this.heatmap);
    // Setup the heatmap
    this.heatmap = new HeatmapOverlay({
      radius: this.heatmapDataPointWorldSize.lat * .7,
      maxOpacity: .2,
      useGradientOpacity: true,
      scaleRadius: true,
      useLocalExtrema: false,
      latField: 'lat',
      lngField: 'lng',
      valueField: 'value',
      gradient: { 0: 'rgba(255, 255, 255, .3)', .25: 'rgba(0, 0, 255, .3)', 0.5: 'rgba(0, 255, 0, .3)', 0.75: 'rgba(255, 255, 0, .3)', 1.0: 'rgba(255, 0, 0, .3)' },
      blur: 0
    }).addTo(this.map);

    // Start routing to the initial position
    this.startRouting(this.currentRoutingTo);
  }
  
  // When the map is clicked, open a popup with a button that sets the routing position to the clicked position
  private mapClicked(position: Leaflet.LatLng) {
    const popup = Leaflet.popup({ closeButton: false });
    const routeHereButton = document.createElement('button');
    routeHereButton.innerText = 'Työpaikka on tässä. Miten pitkään työmatka HSL:llä kestää?';
    routeHereButton.classList.add('btn', 'btn-primary');
    routeHereButton.onclick = evt => {
      evt.preventDefault();
      // Move the marker and start routing to the selected position
      this.marker.setLatLng(position);
      this.map.closePopup();
      this.startRouting(position);
    };
    popup
    .setLatLng(position)
    .setContent(routeHereButton)
    .openOn(this.map);
  }

  // Query the HSL API asynchronously to determine the travel duration between the supplied points, retrying until a value is received or a retry limit is reached, in which case null is returned
  private async travelDurationBetweenPoints(from: Leaflet.LatLng, to: Leaflet.LatLng, abortSignal: AbortSignal): Promise<TravelDurationResult> {
    // GraphQL query that determines the best itinerary between the supplied points, and retrieves its end time (which we use instead of trip duration, since the latter doesn't include pre-trip waiting time)
    const query = 'query Test($from: InputCoordinates, $to: InputCoordinates, $date: String, $time: String) { plan(ignoreRealtimeUpdates: true, from: $from, to: $to, date: $date, time: $time, numItineraries: 1) { itineraries { endTime } } }';
    // HSL API uses EEST timezone
    const timezone = 'Europe/Helsinki';
    // Use the next week's monday at the specified time as the trip search starting time
    const todayAtRouteHour = DateTime.fromFormat(this.routeTime, "hh:mm");
    const startTime = todayAtRouteHour.plus(Duration.fromObject({ weeks: 1 }));

    // If the point is too close to the reference point, adjust its position to separate them
    var separateColocatedPoints = (point: Leaflet.LatLng, reference: Leaflet.LatLng) => point.distanceTo(reference) > .01 ? { lat: point.lat, lon: point.lng } : { lat: point.lat + .01, lon: point.lng };
  
    // Retrieve travel duration from HSL API, retrying up to a max number of time in case of a network error
    const maxAttempts = 5;
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      // Each retry attempt past the first one adds randomized jitter to the route start point, in case it's in the middle of a lake and can't be routed from
      var jitter = (size: number) => (Math.random() * 2 - 1) * attempts / maxAttempts * size;
      const fromJitter = new Leaflet.LatLng(jitter(this.heatmapDataPointWorldSize.lat), jitter(this.heatmapDataPointWorldSize.lng));

      try {
        // Query HSL API
        const result = await fetch('https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql', {
          method: 'POST',
          cache: 'no-cache',
          headers: { 'Content-Type': 'application/json' },
          signal: abortSignal,
          body: JSON.stringify({
            query,
            variables: {
              date: startTime.toISODate(),
              time: startTime.toISOTime({ includeOffset: false, suppressMilliseconds: true }),
              from: separateColocatedPoints(new Leaflet.LatLng(from.lat + fromJitter.lat, from.lng + fromJitter.lng), to),
              to: { lat: to.lat, lon: to.lng }
            }
          })
        });

        // Retry on network error
        if (!result.ok) continue;

        // Parse itineraries from the response
        const response = await result.json();
        if (abortSignal.aborted) return null;
        const itineraries = response.data.plan.itineraries;

        // No itineraries found - might happen if the route start point is blocked, so retry and add jitter
        if (itineraries.length == 0) continue;

        // Use the first (fastest) itinerary, and parse travel duration
        const time = itineraries[0].endTime;
        const endtime = DateTime.fromMillis(time, { zone: timezone });
        const value = endtime.diff(startTime).toMillis() / 1000 / 60;

        // Output travel duration in minutes
        const travelDuration: h337.DataPoint<'value', 'lat', 'lng'> = { value, lat: from.lat, lng: from.lng };
        return travelDuration;
      }
      catch (e) {
        // If user requested the cancellation of this routing operation, abort
        if (e.name === 'AbortError') return null;

        // Retry on network error
        continue;
      }
    }
    return null;
  }

  // Output a list of points around a central point in the shape of a hollow rectangle of width and height of (size * 2 + 1) points
  private pointsInAHollowRectangleAroundCenterPoint(center: Leaflet.LatLng, steps: number, maxStep: number, size: Leaflet.LatLng): ReadonlyArray<PointGenerationResult> {
    const result = new Array<PointGenerationResult>();
    const addPoint = (latStep: number, lngStep: number) => {
      const lat = latStep / maxStep * size.lat / 2 + center.lat;
      const lng = lngStep / maxStep * size.lng / 2 + center.lng;
      result.push({
        tileX: latStep + maxStep,
        tileY: lngStep + maxStep,
        worldPosition: new Leaflet.LatLng(lat, lng)
      });
    }
    // If size is 0, only output the central point itself
    if (steps == 0) addPoint(0, 0);
    else {
      // Output 4 sides of the rectangle, each of length numStepsFromCenter * 2, producing a rectangle whose radius is size * 2 + 1
      for (let i = -steps; i < steps; i++) addPoint(i, -steps);
      for (let i = -steps; i < steps; i++) addPoint(steps, i);
      for (let i = -steps; i < steps; i++) addPoint(i + 1, steps);
      for (let i = -steps; i < steps; i++) addPoint(-steps, i + 1);
    }
    return result;
  }

  // Output a list of points around a center point in the shape of a filled rectangle of width and height of (size * 2 + 1) points, where the innermost points are listed first
  private pointsInAFilledRectangleAroundCenterPoint(center: Leaflet.LatLng, steps: number, size: Leaflet.LatLng): Array<PointGenerationResult> {
    let result = new Array<PointGenerationResult>();
    for (let i = 0; i <= steps; i++) {
      result = result.concat(this.pointsInAHollowRectangleAroundCenterPoint(center, i, steps, size));
    }
    return result;
  }

  // Start finding routes to the target position, expanding outwards, and updating the heatmap to show travel durations
  private async startRouting(routeTo: Leaflet.LatLng) {
    this.currentRoutingTo = routeTo;
    const routingStartTime = DateTime.now();
    const travelDurations = new Array<Array<h337.DataPoint<'value', 'lat', 'lng'>>>();

    // If a previous routing operation is ongoing, abort its HTTP requests
    if (this.currentRoutingOperationAbortController) this.currentRoutingOperationAbortController.abort();
    this.currentRoutingOperationAbortController = new AbortController();

    
    // Apply travel duration cache data to the heatmap
    const updateHeatmap = () => {
      const travelDurationList = travelDurations.reduce((a, b) => a.concat(b)).filter(x => x);
      this.heatmap.setData({
        min: 0,
        max: this.maxTravelDurationInMinutes,
        data: travelDurationList
      });
    };
    
      // Add a travel duration to the cache
      const addTravelDuration = (x: number, y: number, travelDuration: TravelDurationResult) => {
      if (!travelDurations[x]) travelDurations[x] = [];
      travelDurations[x][y] = travelDuration;
    };

    // Start from the target position, and expand outwards in a rectangular shape where data points are uniformly distributed
    const abortSignal = this.currentRoutingOperationAbortController.signal;
    const points = this.pointsInAFilledRectangleAroundCenterPoint(routeTo, this.halfHeatmapDataPointsPerDimension, this.heatmapWorldSize);
    await pool({
      collection: points,
      maxConcurrency: this.numSimultaneousHslApiQueries,
      task: async point => {
        if (abortSignal.aborted) return;
        const travelDuration = await this.travelDurationBetweenPoints(point.worldPosition, routeTo, abortSignal);
        if (abortSignal.aborted) return;
        if (travelDuration) {
          addTravelDuration(point.tileX, point.tileY, travelDuration);
          updateHeatmap();
        }
      }
    });

    const routingEndTime = DateTime.now();
    console.log(`Routing completd in ${routingEndTime.diff(routingStartTime)}ms`);
  }
}

new TravelDurationMap();