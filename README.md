# HSL commute calculator

A tool for visualizing commute durations as a heatmap over OpenStreetMap, using route durations from HSL API.

After the user has selected a location for their workplace on the map, the application will start finding routes to that location in an expanding grid surrounding the selected location. Each successful route will appear as a point on a heatmap over the map, colorized based on the duration of the route (the duration between the selected departure time from the grid point and the earliest possible arrival to the destination). This aids the user in selecting an area to move into that offers a quick public transport commute time. A later addition could be to include average housing price data to further support this use case.

Currently in prototyping phase. HSL API calls are quite slow and many datapoints are needed, so it would be worthwhile to develop an Azure backend that caches queries to speed up usage.
