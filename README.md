# HSL commute calculator

A tool for visualizing commute durations as a heatmap over OpenStreetMap, using route durations from HSL API.

After the user has selected a location for their workplace on the map, the application will start finding routes to that location in an expanding grid surrounding the selected location. Each successful route will appear as a point on a heatmap over the map, colorized based on the duration of the route (the duration between the selected departure time from the grid point and the earliest possible arrival to the destination). This aids the user in selecting an area to move into that offers a quick public transport commute time. A later addition could be to include average housing price data to further support this use case.

Currently in prototyping phase. HSL API calls are quite slow and many datapoints are needed, so it would be worthwhile to develop an Azure backend that caches queries to speed up usage.


## Operation

When a routing target is selected, the application generates an outward expanding list of points centered on the target point. The points are generated in a rectangular shape to maintain uniform data point density, which the heatmap library requires.

First, a single point is generated on the central point. Second, a 3x3 hollow rectangle of points is generated. Then, a 5x5 rectangle, and so forth. By combining the smaller rectangles a filled rectangle is generated. This mode of point generation was chosen because here the points closest to the central point are generated first, so the heatmap starts building around the central point rather than by generating a random point here, another there.

A number of points are selected from these generated points in order of generation, and a HTTP request is made for each to the HSL routing API. A paging solution is used to prevent the browser from generating too many requests at once. Whenever one request is finished, a new one is started, thus maintaining the configured page size. If a request fails, a few retries are made, each with a slightly altered position - this is to avoid the situation where a data point lies on top of a lake or some other obstacle, and therefore HSL API finds no routes; by jittering the position upon each failure, a new route might be found. Sometimes the data point is in the sea or beyond HSL's routing range, and these cases are difficult to tell apart from errors that might be resolved by retrying; as such, a few retries are made but then the point is abandoned to avoid blocked points from taking up the majority of requests.
