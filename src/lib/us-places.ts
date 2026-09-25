import type { LatLng } from "./trip-geo";

/**
 * Where US and Canadian freight cities are, for miles and ETAs when a broker or the owner gives only "City, ST".
 * Freight hubs and the larger metros; anything else falls back to the middle of its state (STATE_CENTER), which is
 * only good for rough distances, so the AI doesn't tell a broker a truck is late from it.
 */
export const MORE_CITIES: Record<string, LatLng> = {
  "Albany, NY": [42.6526, -73.7562], "Albuquerque, NM": [35.0844, -106.6504], "Allentown, PA": [40.6023, -75.4714],
  "Amarillo, TX": [35.222, -101.8313], "Anaheim, CA": [33.8366, -117.9143], "Baltimore, MD": [39.2904, -76.6122],
  "Baton Rouge, LA": [30.4515, -91.1871], "Billings, MT": [45.7833, -108.5007], "Birmingham, AL": [33.5186, -86.8104],
  "Boise, ID": [43.615, -116.2023], "Boston, MA": [42.3601, -71.0589], "Bowling Green, KY": [36.9685, -86.4808],
  "Buffalo, NY": [42.8864, -78.8784], "Carlisle, PA": [40.2015, -77.2003], "Cedar Rapids, IA": [41.9779, -91.6656],
  "Charleston, SC": [32.7765, -79.9311], "Charleston, WV": [38.3498, -81.6326], "Chattanooga, TN": [35.0456, -85.3097],
  "Cheyenne, WY": [41.14, -104.8202], "Cincinnati, OH": [39.1031, -84.512], "Cleveland, OH": [41.4993, -81.6944],
  "Colorado Springs, CO": [38.8339, -104.8214], "Columbia, SC": [34.0007, -81.0348], "Corpus Christi, TX": [27.8006, -97.3964],
  "Dayton, OH": [39.7589, -84.1916], "Des Moines, IA": [41.5868, -93.625], "Detroit, MI": [42.3314, -83.0458],
  "El Paso, TX": [31.7619, -106.485], "Elizabeth, NJ": [40.664, -74.2107], "Fargo, ND": [46.8772, -96.7898],
  "Fontana, CA": [34.0922, -117.435], "Fort Wayne, IN": [41.0793, -85.1394], "Fresno, CA": [36.7378, -119.7871],
  "Gainesville, GA": [34.2979, -83.8241], "Grand Rapids, MI": [42.9634, -85.6681], "Green Bay, WI": [44.5133, -88.0133],
  "Greensboro, NC": [36.0726, -79.792], "Greenville, SC": [34.8526, -82.394], "Gulfport, MS": [30.3674, -89.0928],
  "Harrisburg, PA": [40.2732, -76.8867], "Hartford, CT": [41.7658, -72.6734], "Jackson, MS": [32.2988, -90.1848],
  "Jacksonville, FL": [30.3322, -81.6557], "Joliet, IL": [41.525, -88.0817], "Knoxville, TN": [35.9606, -83.9207],
  "Lakeland, FL": [28.0395, -81.9498], "Laredo, TX": [27.5306, -99.4803], "Las Vegas, NV": [36.1699, -115.1398],
  "Lexington, KY": [38.0406, -84.5037], "Lincoln, NE": [40.8136, -96.7026], "Little Rock, AR": [34.7465, -92.2896],
  "Long Beach, CA": [33.7701, -118.1937], "Louisville, KY": [38.2527, -85.7585], "Lubbock, TX": [33.5779, -101.8552],
  "Madison, WI": [43.0731, -89.4012], "McAllen, TX": [26.2034, -98.23], "Milwaukee, WI": [43.0389, -87.9065],
  "Minneapolis, MN": [44.9778, -93.265], "Mobile, AL": [30.6954, -88.0399], "Modesto, CA": [37.6391, -120.9969],
  "Montgomery, AL": [32.3668, -86.3], "Newark, NJ": [40.7357, -74.1724], "New Orleans, LA": [29.9511, -90.0715],
  "New York, NY": [40.7128, -74.006], "Norfolk, VA": [36.8508, -76.2859], "Oakland, CA": [37.8044, -122.2712],
  "Odessa, TX": [31.8457, -102.3676], "Omaha, NE": [41.2565, -95.9345], "Ontario, CA": [34.0633, -117.6509],
  "Orlando, FL": [28.5383, -81.3792], "Pittsburgh, PA": [40.4406, -79.9959], "Raleigh, NC": [35.7796, -78.6382],
  "Reno, NV": [39.5296, -119.8138], "Richmond, VA": [37.5407, -77.436], "Riverside, CA": [33.9806, -117.3755],
  "Roanoke, VA": [37.271, -79.9414], "Rochester, NY": [43.1566, -77.6088], "Sacramento, CA": [38.5816, -121.4944],
  "Saint Louis, MO": [38.627, -90.1994], "St. Louis, MO": [38.627, -90.1994], "St Louis, MO": [38.627, -90.1994],
  "Salinas, CA": [36.6777, -121.6555], "San Bernardino, CA": [34.1083, -117.2898], "San Francisco, CA": [37.7749, -122.4194],
  "San Jose, CA": [37.3382, -121.8863], "Savannah, GA": [32.0809, -81.0912], "Scranton, PA": [41.4089, -75.6624],
  "Shreveport, LA": [32.5252, -93.7502], "Sioux City, IA": [42.4999, -96.4003], "Sioux Falls, SD": [43.5446, -96.7311],
  "South Bend, IN": [41.6764, -86.252], "Spokane, WA": [47.6588, -117.426], "Springfield, MO": [37.209, -93.2923],
  "Springfield, IL": [39.7817, -89.6501], "Stockton, CA": [37.9577, -121.2908], "Syracuse, NY": [43.0481, -76.1474],
  "Tacoma, WA": [47.2529, -122.4443], "Tampa, FL": [27.9506, -82.4572], "Toledo, OH": [41.6528, -83.5379],
  "Tucson, AZ": [32.2226, -110.9747], "Tulsa, OK": [36.154, -95.9928], "Wichita, KS": [37.6872, -97.3301],
  "Wilmington, NC": [34.2257, -77.9447], "Winston-Salem, NC": [36.0999, -80.2442], "Yakima, WA": [46.6021, -120.5059],
  "Fort Smith, AR": [35.3859, -94.3985], "Joplin, MO": [37.0842, -94.5133], "Texarkana, TX": [33.4251, -94.0477],
  "Waukegan, IL": [42.3636, -87.8448], "Elkhart, IN": [41.6819, -85.9767], "Toronto, ON": [43.6532, -79.3832],
  "Montreal, QC": [45.5019, -73.5674], "Vancouver, BC": [49.2827, -123.1207], "Calgary, AB": [51.0447, -114.0719],
  "Edmonton, AB": [53.5461, -113.4938], "Winnipeg, MB": [49.8951, -97.1384],
};

/** The rough middle of each state, for when a city isn't known. Good for a ballpark, not an ETA. */
export const STATE_CENTER: Record<string, LatLng> = {
  AL: [32.8, -86.8], AK: [61.4, -152.3], AZ: [34.2, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.5], CO: [39.0, -105.5],
  CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.8, -156.3],
  ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.0, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3],
  LA: [31.1, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3],
  MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6],
  NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9], SD: [44.4, -100.2],
  TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5],
  WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.6], ON: [44.5, -79.5], QC: [46.8, -71.2], BC: [53.7, -127.6],
  AB: [53.9, -116.6], MB: [53.8, -98.8], SK: [52.9, -106.5],
};
