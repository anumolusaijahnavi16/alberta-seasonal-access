/**
 * Alberta Seasonal Access & Essential Supply Resilience Analyzer
 * Author: Sai Jahnavi Anumolu
 * Personal GIS Project — August 2026
 */

import { useEffect, useRef, useState } from "react";

import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";

import * as geodesicBufferOperator from "@arcgis/core/geometry/operators/geodesicBufferOperator";
import * as geodeticLengthOperator from "@arcgis/core/geometry/operators/geodeticLengthOperator";
import * as intersectionOperator from "@arcgis/core/geometry/operators/intersectionOperator";

import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import Search from "@arcgis/core/widgets/Search";

import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5112";

const ALBERTA_ACCESS_SERVICE =
  "https://geospatial.alberta.ca/titan/rest/services/utility/access/MapServer";

const WINTER_ROADS_URL = `${ALBERTA_ACCESS_SERVICE}/26`;
const PAVED_ROADS_URL = `${ALBERTA_ACCESS_SERVICE}/14`;
const GRAVEL_ROADS_URL = `${ALBERTA_ACCESS_SERVICE}/23`;

// ========================================================
// ASP.NET CORE API TYPES
// ========================================================

interface PopulationContextResponse {
  communityName: string;
  population: number | null;
  year: number | null;
  geography: string | null;
  parentMunicipality: string | null;
  source: string;
  message: string | null;
}

interface AccessAnalysisResponse {
  communityName: string;
  communityType: string;

  pavedRoadKm: number;
  gravelRoadKm: number;
  winterRoadKm: number;

  allSeasonRoadKm: number;
  totalAnalyzedRoadKm: number;

  winterSegmentCount: number;
  analysisRadiusKm: number;

  seasonalDependencyPercent: number;
  dependencyLevel: string;

  resilienceScore: number;
  resilienceLevel: string;
}

function App() {
  const mapDiv = useRef<HTMLDivElement>(null);

  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [dataRetrievedAt] = useState(() => new Date());

  const winterRoadsRef = useRef<FeatureLayer | null>(null);
  const pavedRoadsRef = useRef<FeatureLayer | null>(null);
  const gravelRoadsRef = useRef<FeatureLayer | null>(null);

  const otherPublicAirportsRef = useRef<FeatureLayer | null>(null);
  const regionalAirportsRef = useRef<FeatureLayer | null>(null);
  const internationalAirportsRef = useRef<FeatureLayer | null>(null);
  const communitiesRef = useRef<FeatureLayer | null>(null);

  const [winterRoadsVisible, setWinterRoadsVisible] =
    useState(true);

  const [pavedRoadsVisible, setPavedRoadsVisible] =
    useState(false);

  const [gravelRoadsVisible, setGravelRoadsVisible] =
    useState(false);

  const [communitiesVisible, setCommunitiesVisible] =
    useState(true);

  const [winterRoadCount, setWinterRoadCount] = useState<
    number | null
  >(null);

  const [communityCount, setCommunityCount] = useState<
    number | null
  >(null);

  const [selectedCommunity, setSelectedCommunity] = useState<
    string | null
  >(null);

  const [selectedCommunityType, setSelectedCommunityType] =
    useState<string | null>(null);

  const [winterSegmentCount, setWinterSegmentCount] =
    useState<number | null>(null);

  const [winterRoadLength, setWinterRoadLength] = useState<
    number | null
  >(null);

  const [pavedRoadLength, setPavedRoadLength] = useState<
    number | null
  >(null);

  const [gravelRoadLength, setGravelRoadLength] = useState<
    number | null
  >(null);

  // ========================================================
  // COMMUNITY CONTEXT
  // Population + airport proximity
  // ========================================================

  const [communityPopulation, setCommunityPopulation] =
    useState<number | null>(null);

  const [populationYear, setPopulationYear] =
    useState<number | null>(null);

  const [populationGeography, setPopulationGeography] =
    useState<string | null>(null);

  const [populationMessage, setPopulationMessage] =
    useState<string | null>(null);

  const [parentMunicipality, setParentMunicipality] =
    useState<string | null>(null);

  const [populationLoading, setPopulationLoading] =
    useState(false);

  const [nearestPublicAirport, setNearestPublicAirport] = useState<{
    name: string;
    distanceKm: number;
  } | null>(null);

  const [nearestRegionalAirport, setNearestRegionalAirport] = useState<{
    name: string;
    distanceKm: number;
  } | null>(null);

  const [nearestInternationalAirport, setNearestInternationalAirport] =
    useState<{
      name: string;
      distanceKm: number;
    } | null>(null);

  const [backendAnalysis, setBackendAnalysis] =
    useState<AccessAnalysisResponse | null>(null);

  const [analysisLoading, setAnalysisLoading] =
    useState(false);

  const [analysisError, setAnalysisError] = useState<
    string | null
  >(null);

  // User-selectable analysis radius. A ref is used by the ArcGIS
  // click handler so changing the radius does not recreate the map.
  const [analysisRadiusKm, setAnalysisRadiusKm] = useState(50);
  const analysisRadiusRef = useRef(50);

  // The ArcGIS analysis lives inside the map initialization effect.
  // This ref lets the radius buttons ask that analysis to rerun for
  // the currently selected community without recreating the map.
  const reanalyzeSelectedCommunityRef = useRef<
    (() => Promise<void>) | null
  >(null);

  const handleRadiusChange = (radius: number) => {
    if (radius === analysisRadiusRef.current) return;

    setAnalysisRadiusKm(radius);
    analysisRadiusRef.current = radius;
    setAnalysisError(null);

    // If a community has already been selected, immediately rerun
    // the GIS + backend analysis using the new radius.
    void reanalyzeSelectedCommunityRef.current?.();
  };

  // ======================================================
  // DERIVED METRICS
  //
  // When the backend has responded, use the C# values.
  // Before that, fall back to the local GIS calculations.
  // ======================================================

  const localAllSeasonRoadLength =
    pavedRoadLength !== null && gravelRoadLength !== null
      ? pavedRoadLength + gravelRoadLength
      : null;

  const localTotalAnalyzedRoadLength =
    localAllSeasonRoadLength !== null &&
      winterRoadLength !== null
      ? localAllSeasonRoadLength + winterRoadLength
      : null;

  const localSeasonalDependencyPercent =
    localTotalAnalyzedRoadLength !== null &&
      localTotalAnalyzedRoadLength > 0 &&
      winterRoadLength !== null
      ? (winterRoadLength /
        localTotalAnalyzedRoadLength) *
      100
      : null;

  const localSeasonalDependencyLevel =
    localSeasonalDependencyPercent === null
      ? null
      : localSeasonalDependencyPercent < 20
        ? "Low"
        : localSeasonalDependencyPercent < 50
          ? "Moderate"
          : "High";

  const allSeasonRoadLength =
    backendAnalysis?.allSeasonRoadKm ??
    localAllSeasonRoadLength;

  const seasonalDependencyPercent =
    backendAnalysis?.seasonalDependencyPercent ??
    localSeasonalDependencyPercent;

  const seasonalDependencyLevel =
    backendAnalysis?.dependencyLevel ??
    localSeasonalDependencyLevel;

  const resilienceScore =
    backendAnalysis?.resilienceScore ?? null;

  const resilienceLevel =
    backendAnalysis?.resilienceLevel ?? null;

  const dependencyClass =
    seasonalDependencyLevel?.toLowerCase() ?? "";

  const resilienceClass =
    resilienceLevel?.toLowerCase() ?? "";

  // ======================================================
  // ABOUT & METHODOLOGY MODAL
  // ======================================================

  useEffect(() => {
    if (!methodologyOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMethodologyOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [methodologyOpen]);

  // ======================================================
  // MAP INITIALIZATION
  // ======================================================

  useEffect(() => {
    if (!mapDiv.current) return;

    const map = new Map({
      basemap: "streets-navigation-vector",
    });

    // ----------------------------------------------------
    // WINTER ROADS
    // ----------------------------------------------------

    const winterRoads = new FeatureLayer({
      url: WINTER_ROADS_URL,

      title: "Winter Roads",

      minScale: 0,

      definitionExpression:
        "FEATURE_TYPE = 'ROAD-WINTER-ROAD'",

      outFields: ["*"],

      renderer: new SimpleRenderer({
        symbol: new SimpleLineSymbol({
          color: "#d946ef",
          width: 3.5,
          style: "solid",
        }),
      }),

      popupEnabled: false,
    });

    map.add(winterRoads);

    winterRoadsRef.current = winterRoads;

    // ----------------------------------------------------
    // PAVED ROADS
    // ----------------------------------------------------

    const pavedRoads = new FeatureLayer({
      url: PAVED_ROADS_URL,

      title: "Paved Roads",

      minScale: 0,

      visible: false,

      outFields: ["*"],

      renderer: new SimpleRenderer({
        symbol: new SimpleLineSymbol({
          color: "#22c55e",
          width: 2.5,
          style: "solid",
        }),
      }),

      popupEnabled: false,
    });

    map.add(pavedRoads);

    pavedRoadsRef.current = pavedRoads;

    // ----------------------------------------------------
    // GRAVEL ROADS
    // ----------------------------------------------------

    const gravelRoads = new FeatureLayer({
      url: GRAVEL_ROADS_URL,

      title: "Gravel Roads",

      minScale: 0,

      visible: false,

      outFields: ["*"],

      renderer: new SimpleRenderer({
        symbol: new SimpleLineSymbol({
          color: "#f59e0b",
          width: 2.5,
          style: "solid",
        }),
      }),

      popupEnabled: false,
    });

    // ========================================================
    // GOVERNMENT OF ALBERTA PUBLIC AIRPORTS
    // ========================================================

    const otherPublicAirports = new FeatureLayer({
      url: "https://geospatial.alberta.ca/arcgis/rest/services/Highway_Economic_Corridor/MapServer/27",
      outFields: ["*"],
      visible: false,
    });

    const regionalAirports = new FeatureLayer({
      url: "https://geospatial.alberta.ca/arcgis/rest/services/Highway_Economic_Corridor/MapServer/28",
      outFields: ["*"],
      visible: false,
    });

    const internationalAirports = new FeatureLayer({
      url: "https://geospatial.alberta.ca/arcgis/rest/services/Highway_Economic_Corridor/MapServer/29",
      outFields: ["*"],
      visible: false,
    });

    otherPublicAirportsRef.current = otherPublicAirports;
    regionalAirportsRef.current = regionalAirports;
    internationalAirportsRef.current = internationalAirports;

    map.add(gravelRoads);

    gravelRoadsRef.current = gravelRoads;

    // ----------------------------------------------------
    // ALBERTA COMMUNITIES
    // ----------------------------------------------------

    const communities = new FeatureLayer({
      url:
        "https://geospatial.alberta.ca/titan/rest/services/boundaries/municipal_communities_public/FeatureServer/0",

      title: "Alberta Communities",

      minScale: 0,

      outFields: ["*"],

      renderer: new SimpleRenderer({
        symbol: new SimpleMarkerSymbol({
          color: [37, 99, 235, 0.82],

          size: 7,

          outline: {
            color: [255, 255, 255, 0.9],
            width: 1.2,
          },
        }),

        visualVariables: [
          {
            type: "size",

            valueExpression: "$view.scale",

            stops: [
              {
                value: 8000000,
                size: 3,
              },
              {
                value: 3000000,
                size: 5,
              },
              {
                value: 1000000,
                size: 8,
              },
              {
                value: 250000,
                size: 11,
              },
            ],
          },
        ],
      }),

      popupEnabled: false,
    });

    map.add(communities);

    communitiesRef.current = communities;

    // ----------------------------------------------------
    // ANALYSIS GRAPHICS
    // ----------------------------------------------------

    const analysisGraphics = new GraphicsLayer({
      title: "Community Analysis",
      listMode: "hide",
    });

    map.add(analysisGraphics);

    // ----------------------------------------------------
    // MAP VIEW
    // ----------------------------------------------------

    const view = new MapView({
      container: mapDiv.current,

      map,

      center: [-114.2, 55.3],

      zoom: 5,
    });

    // ----------------------------------------------------
    // INITIAL ALBERTA EXTENT
    // ----------------------------------------------------

    view.when(() => {
      communities
        .when()
        .then(() => {
          if (!communities.fullExtent) return;

          return view.goTo(
            {
              target:
                communities.fullExtent.expand(1.05),
            },
            {
              duration: 700,
            }
          );
        })
        .catch((error) => {
          console.debug(
            "Initial Alberta extent navigation interrupted:",
            error
          );
        });
    });

    // ----------------------------------------------------
    // SEARCH
    // ----------------------------------------------------

    const searchWidget = new Search({
      view,

      includeDefaultSources: true,

      locationEnabled: false,

      popupEnabled: false,
    });

    view.ui.add(searchWidget, {
      position: "top-right",
    });

    // ====================================================
    // ROAD LENGTH HELPER
    // ====================================================

    const calculateClippedRoadLength = async (
      layer: FeatureLayer,

      bufferGeometry: NonNullable<
        ReturnType<
          typeof geodesicBufferOperator.execute
        >
      >
    ) => {
      const query = layer.createQuery();

      query.geometry = bufferGeometry;

      query.spatialRelationship = "intersects";

      query.returnGeometry = true;

      query.outFields = ["*"];

      const result =
        await layer.queryFeatures(query);

      let totalLengthKm = 0;

      for (const feature of result.features) {
        if (!feature.geometry) continue;

        const clippedGeometry =
          intersectionOperator.execute(
            feature.geometry,
            bufferGeometry
          );

        if (!clippedGeometry) continue;

        const lengthKm =
          geodeticLengthOperator.execute(
            clippedGeometry,
            {
              unit: "kilometers",
            }
          );

        if (Number.isFinite(lengthKm)) {
          totalLengthKm += Math.abs(lengthKm);
        }
      }

      return {
        featureCount: result.features.length,
        lengthKm: totalLengthKm,
      };
    };

    const findNearestAirportInLayer = async (
      airportLayer: FeatureLayer,
      communityGeometry: Point
    ) => {
      const query = airportLayer.createQuery();

      // Query the complete Alberta airport category. We calculate the
      // nearest geodetic distance below, so remote communities are not
      // excluded by an arbitrary search-radius cutoff.
      query.where = "1=1";
      query.returnGeometry = true;
      query.outFields = ["*"];

      const result = await airportLayer.queryFeatures(query);

      let nearestName: string | null = null;
      let nearestDistanceKm = Infinity;

      for (const airport of result.features) {
        if (!airport.geometry) continue;

        const airportPoint = airport.geometry as Point;

        const line = new Polyline({
          spatialReference: communityGeometry.spatialReference,

          paths: [
            [
              [communityGeometry.x, communityGeometry.y],
              [airportPoint.x, airportPoint.y],
            ],
          ],
        });

        const distanceKm = Math.abs(
          geodeticLengthOperator.execute(line, {
            unit: "kilometers",
          })
        );

        if (
          Number.isFinite(distanceKm) &&
          distanceKm < nearestDistanceKm
        ) {
          nearestDistanceKm = distanceKm;

          nearestName =
            airport.attributes?.AIRPORT_NAME ??
            airport.attributes?.airport_name ??
            "Airport";
        }
      }

      if (
        nearestName === null ||
        !Number.isFinite(nearestDistanceKm)
      ) {
        return null;
      }

      return {
        name: nearestName,
        distanceKm: nearestDistanceKm,
      };
    };

    // ====================================================
    // ASP.NET CORE RESILIENCE ANALYSIS
    // ====================================================

    const requestBackendAnalysis = async (
      communityName: string,
      communityType: string,
      pavedKm: number,
      gravelKm: number,
      winterKm: number,
      winterSegments: number
    ): Promise<AccessAnalysisResponse> => {
      const response = await fetch(
        `${API_BASE_URL}/api/access/analyze`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            communityName,
            communityType,

            // Send the actual unrounded ArcGIS results.
            pavedRoadKm: pavedKm,
            gravelRoadKm: gravelKm,
            winterRoadKm: winterKm,

            winterSegmentCount: winterSegments,

            analysisRadiusKm: analysisRadiusRef.current,
          }),
        }
      );

      if (!response.ok) {
        const message = await response.text();

        throw new Error(
          `ASP.NET Core analysis failed (${response.status}): ${message}`
        );
      }

      return (await response.json()) as AccessAnalysisResponse;
    };

    const requestPopulationContext = async (
      communityName: string,
      point: Point
    ): Promise<PopulationContextResponse> => {
      const params = new URLSearchParams({
        longitude: point.longitude.toString(),
        latitude: point.latitude.toString(),
      });

      const response = await fetch(
        `${API_BASE_URL}/api/population/${encodeURIComponent(communityName)}?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(
          `Population lookup failed (${response.status})`
        );
      }

      return (await response.json()) as PopulationContextResponse;
    };

    // ====================================================
    // COMMUNITY CLICK ANALYSIS
    // ====================================================

    let lastSelectedCommunityGraphic: Graphic | null = null;

    const analyzeCommunityGraphic = async (
      communityGraphic: Graphic
    ) => {
      try {
        const communityName =
          communityGraphic.attributes?.CULPT_NAME;

        const communityType =
          communityGraphic.attributes?.TYPE ??
          "Unknown";

        const selectedGeometry =
          communityGraphic.geometry;

        if (
          !communityName ||
          !selectedGeometry
        ) {
          return;
        }

        // ----------------------------------------------
        // RESET PREVIOUS ANALYSIS
        // ----------------------------------------------

        setSelectedCommunity(communityName);

        setSelectedCommunityType(
          communityType
        );

        setWinterSegmentCount(null);

        setWinterRoadLength(null);

        setPavedRoadLength(null);

        setGravelRoadLength(null);

        setNearestPublicAirport(null);
        setNearestRegionalAirport(null);
        setNearestInternationalAirport(null);

        setCommunityPopulation(null);
        setPopulationYear(null);
        setPopulationGeography(null);
        setPopulationMessage(null);
        setParentMunicipality(null);
        setPopulationLoading(true);

        void requestPopulationContext(
          communityName,
          selectedGeometry as Point
        )
          .then((populationContext) => {
            setCommunityPopulation(populationContext.population);
            setPopulationYear(populationContext.year);
            setPopulationGeography(populationContext.geography);
            setPopulationMessage(populationContext.message);
            setParentMunicipality(populationContext.parentMunicipality);
          })
          .catch((error) => {
            console.warn("Population lookup failed:", error);
            setPopulationMessage("Current estimate unavailable");
          })
          .finally(() => {
            setPopulationLoading(false);
          });

        setBackendAnalysis(null);

        setAnalysisError(null);

        setAnalysisLoading(true);

        analysisGraphics.removeAll();

        // ----------------------------------------------
        // LOAD GEOMETRY OPERATORS
        // ----------------------------------------------

        if (
          !geodesicBufferOperator.isLoaded()
        ) {
          await geodesicBufferOperator.load();
        }

        if (
          !geodeticLengthOperator.isLoaded()
        ) {
          await geodeticLengthOperator.load();
        }

        // ----------------------------------------------
        // CREATE USER-SELECTED ANALYSIS BUFFER
        // ----------------------------------------------

        const bufferGeometry =
          geodesicBufferOperator.execute(
            selectedGeometry,
            analysisRadiusRef.current,
            {
              unit: "kilometers",
            }
          );

        if (!bufferGeometry) {
          throw new Error(
            "Unable to create the community analysis buffer."
          );
        }

        // ----------------------------------------------
        // BUFFER GRAPHIC
        // ----------------------------------------------

        const bufferGraphic = new Graphic({
          geometry: bufferGeometry,

          symbol: {
            type: "simple-fill",

            color: [
              37,
              99,
              235,
              0.07,
            ],

            outline: {
              color: [
                59,
                130,
                246,
                0.95,
              ],

              width: 2,
            },
          },
        });

        analysisGraphics.add(bufferGraphic);

        // ----------------------------------------------
        // SELECTED COMMUNITY
        // ----------------------------------------------

        const selectedMarker =
          new Graphic({
            geometry: selectedGeometry,

            symbol:
              new SimpleMarkerSymbol({
                color: [
                  6,
                  182,
                  212,
                  1,
                ],

                size: 17,

                outline: {
                  color: [
                    255,
                    255,
                    255,
                    1,
                  ],

                  width: 3,
                },
              }),

            attributes: {
              communityName,
              communityType,
            },
          });

        analysisGraphics.add(
          selectedMarker
        );

        // ----------------------------------------------
        // FRAME ANALYSIS AREA
        // ----------------------------------------------

        const bufferExtent =
          bufferGeometry.extent;

        if (bufferExtent) {
          try {
            await view.goTo(
              {
                target:
                  bufferExtent.expand(
                    1.18
                  ),
              },
              {
                duration: 700,
              }
            );
          } catch (
          navigationError
          ) {
            console.debug(
              "Analysis navigation interrupted:",
              navigationError
            );
          }
        }

        // ----------------------------------------------
        // RUN GIS ROAD NETWORK ANALYSIS
        // ----------------------------------------------

        const [winterAnalysis, pavedAnalysis, gravelAnalysis] =
          await Promise.all([
            calculateClippedRoadLength(winterRoads, bufferGeometry),
            calculateClippedRoadLength(pavedRoads, bufferGeometry),
            calculateClippedRoadLength(gravelRoads, bufferGeometry),
          ]);

        // Airport proximity is supplementary community context. Keep it
        // isolated so an airport-service issue cannot break the core
        // road-network or ASP.NET Core resilience analysis.
        const airportResults = await Promise.allSettled([
          findNearestAirportInLayer(
            otherPublicAirports,
            selectedGeometry as Point
          ),
          findNearestAirportInLayer(
            regionalAirports,
            selectedGeometry as Point
          ),
          findNearestAirportInLayer(
            internationalAirports,
            selectedGeometry as Point
          ),
        ]);

        const airportValue = (
          result: PromiseSettledResult<{
            name: string;
            distanceKm: number;
          } | null>
        ) => {
          if (result.status === "fulfilled") return result.value;

          console.warn("Airport proximity query failed:", result.reason);
          return null;
        };

        setNearestPublicAirport(airportValue(airportResults[0]));
        setNearestRegionalAirport(airportValue(airportResults[1]));
        setNearestInternationalAirport(airportValue(airportResults[2]));

        // ----------------------------------------------
        // STORE RAW GIS RESULTS
        // ----------------------------------------------

        setWinterSegmentCount(
          winterAnalysis.featureCount
        );

        setWinterRoadLength(
          winterAnalysis.lengthKm
        );

        setPavedRoadLength(
          pavedAnalysis.lengthKm
        );

        setGravelRoadLength(
          gravelAnalysis.lengthKm
        );

        // ----------------------------------------------
        // SEND RESULTS TO ASP.NET CORE
        // ----------------------------------------------

        const apiAnalysis =
          await requestBackendAnalysis(
            communityName,
            communityType,

            pavedAnalysis.lengthKm,
            gravelAnalysis.lengthKm,
            winterAnalysis.lengthKm,

            winterAnalysis.featureCount
          );

        setBackendAnalysis(apiAnalysis);

        setAnalysisLoading(false);

        // ----------------------------------------------
        // DEVELOPMENT VALIDATION
        // ----------------------------------------------

        console.log(
          `📍 Access analysis for ${communityName}`
        );

        console.log(
          "ArcGIS paved road length:",
          pavedAnalysis.lengthKm.toFixed(
            2
          ),
          "km"
        );

        console.log(
          "ArcGIS gravel road length:",
          gravelAnalysis.lengthKm.toFixed(
            2
          ),
          "km"
        );

        console.log(
          "ArcGIS winter road length:",
          winterAnalysis.lengthKm.toFixed(
            2
          ),
          "km"
        );

        console.log(
          "ASP.NET Core response:",
          apiAnalysis
        );

        console.log(
          "Resilience score:",
          apiAnalysis.resilienceScore
        );
      } catch (error) {
        console.error(
          "Community access analysis failed:",
          error
        );

        setAnalysisError(
          "Unable to complete access analysis. Make sure the ASP.NET Core API is running on port 5112."
        );

        setAnalysisLoading(false);
      }
    };

    // Radius buttons call this ref. Because the selected Graphic is
    // retained here, changing 25/50/75/100 km immediately rebuilds
    // the buffer, road statistics, and backend indicator.
    reanalyzeSelectedCommunityRef.current = async () => {
      if (!lastSelectedCommunityGraphic) return;
      await analyzeCommunityGraphic(lastSelectedCommunityGraphic);
    };

    const clickHandle = view.on(
      "click",
      async (event) => {
        try {
          const response = await view.hitTest(event, {
            include: [communities],
          });

          const communityResult = response.results.find(
            (result) => result.type === "graphic"
          );

          if (
            !communityResult ||
            communityResult.type !== "graphic"
          ) {
            return;
          }

          lastSelectedCommunityGraphic = communityResult.graphic;
          await analyzeCommunityGraphic(communityResult.graphic);
        } catch (error) {
          console.error(
            "Community selection failed:",
            error
          );
        }
      }
    );

    // ====================================================
    // DATASET VALIDATION
    // ====================================================

    winterRoads
      .when()
      .then(() =>
        winterRoads.queryFeatureCount()
      )
      .then((count) => {
        setWinterRoadCount(count);

        console.log(
          "Alberta winter road features:",
          count
        );
      })
      .catch((error) => {
        console.error(
          "Winter Roads layer error:",
          error
        );
      });

    communities
      .when()
      .then(() =>
        communities.queryFeatureCount()
      )
      .then((count) => {
        setCommunityCount(count);

        console.log(
          "Alberta community features:",
          count
        );
      })
      .catch((error) => {
        console.error(
          "Communities layer error:",
          error
        );
      });

    pavedRoads.when().catch((error) => {
      console.error(
        "Paved Roads layer error:",
        error
      );
    });

    gravelRoads.when().catch((error) => {
      console.error(
        "Gravel Roads layer error:",
        error
      );
    });

    // ====================================================
    // CLEANUP
    // ====================================================

    return () => {
      clickHandle.remove();
      reanalyzeSelectedCommunityRef.current = null;

      view.destroy();

      winterRoadsRef.current = null;

      pavedRoadsRef.current = null;

      gravelRoadsRef.current = null;

      otherPublicAirportsRef.current = null;
      regionalAirportsRef.current = null;
      internationalAirportsRef.current = null;

      communitiesRef.current = null;
    };
  }, []);

  // ======================================================
  // UI HELPERS
  // ======================================================

  const metricValue = (
    value: number | null,
    suffix = " km"
  ) => {
    if (analysisLoading) return "...";

    if (value === null) return "—";

    return `${value.toFixed(1)}${suffix}`;
  };

  // ======================================================
  // RENDER
  // ======================================================

  return (
    <div className="app-shell">
      {/* =================================================
          HEADER
      ================================================= */}

      <header className="topbar">
        <div className="brand">
          <div
            className="brand-mark"
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
          </div>

          <div>
            <div className="eyebrow">
              ALBERTA ACCESS INTELLIGENCE
            </div>

            <h1>
              Seasonal Access & Supply
              Resilience
            </h1>
          </div>
        </div>

        <div className="topbar-meta">
          <div className="data-status">
            <span className="status-dot" />

            GOVERNMENT OF ALBERTA DATA
          </div>

          <button
            type="button"
            className="methodology-button"
            onClick={() => setMethodologyOpen(true)}
          >
            About & Methodology
          </button>

          <div className="radius-selector" aria-label="Analysis radius">
            <span className="radius-selector-label">ANALYSIS RADIUS</span>

            {[25, 50, 75, 100].map((radius) => (
              <button
                key={radius}
                type="button"
                className={
                  analysisRadiusKm === radius
                    ? "radius-option active"
                    : "radius-option"
                }
                onClick={() => handleRadiusChange(radius)}
                disabled={analysisLoading}
                aria-pressed={analysisRadiusKm === radius}
              >
                {radius} km
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* =================================================
          WORKSPACE
      ================================================= */}

      <div className="workspace">
        {/* ===============================================
            ANALYSIS PANEL
        =============================================== */}

        <aside className="analysis-panel">
          <div className="panel-scroll">
            {/* COMMUNITY */}

            <section className="panel-intro">
              <span className="section-kicker">
                COMMUNITY PROFILE
              </span>

              <div className="community-heading">
                <div>
                  <h2>
                    {selectedCommunity ??
                      "Select a community"}
                  </h2>

                  <p>
                    {selectedCommunityType ??
                      "Choose a community point on the map"}
                  </p>
                </div>

                {selectedCommunity && (
                  <div
                    className="selected-indicator"
                    title="Community selected"
                  >
                    ✓
                  </div>
                )}
              </div>
            </section>

            {/* COMMUNITY CONTEXT */}

            {selectedCommunity && (
              <section className="community-context">
                <span className="section-kicker">
                  COMMUNITY CONTEXT
                </span>

                <div className="community-context-cards">
                  <div className="context-card population-card">
                    <span className="context-label">
                      POPULATION
                    </span>

                    <strong className="population-value">
                      {populationLoading
                        ? "..."
                        : communityPopulation !== null
                          ? communityPopulation.toLocaleString()
                          : "—"}
                    </strong>

                    {!populationLoading &&
                      communityPopulation !== null &&
                      populationYear !== null && (
                        <small>
                          {populationYear}
                          {populationGeography
                            ? ` · ${populationGeography.split(" · ")[0]}`
                            : ""}
                        </small>
                      )}

                    {!populationLoading &&
                      communityPopulation === null &&
                      populationMessage && (
                        <small>{populationMessage}</small>
                      )}

                    {!populationLoading &&
                      communityPopulation === null &&
                      parentMunicipality && (
                        <small>
                          <strong>{parentMunicipality}</strong>
                          {" · surrounding municipality"}
                        </small>
                      )}
                  </div>

                  <div className="context-card air-access-card">
                    <div className="air-access-header">
                      <span className="context-label">
                        AIR ACCESS
                      </span>
                      <small>
                        Nearest airport by category
                      </small>
                    </div>

                    <div className="airport-list">
                      <div className="airport-item">
                        <span className="airport-type">
                          PUBLIC
                        </span>
                        <strong>
                          {analysisLoading
                            ? "Finding..."
                            : nearestPublicAirport?.name ?? "—"}
                        </strong>
                        {nearestPublicAirport && !analysisLoading && (
                          <small>
                            {nearestPublicAirport.distanceKm.toFixed(1)} km away
                          </small>
                        )}
                      </div>

                      <div className="airport-item">
                        <span className="airport-type">
                          REGIONAL
                        </span>
                        <strong>
                          {analysisLoading
                            ? "Finding..."
                            : nearestRegionalAirport?.name ?? "—"}
                        </strong>
                        {nearestRegionalAirport && !analysisLoading && (
                          <small>
                            {nearestRegionalAirport.distanceKm.toFixed(1)} km away
                          </small>
                        )}
                      </div>

                      <div className="airport-item">
                        <span className="airport-type">
                          INTERNATIONAL
                        </span>
                        <strong>
                          {analysisLoading
                            ? "Finding..."
                            : nearestInternationalAirport?.name ?? "—"}
                        </strong>
                        {nearestInternationalAirport && !analysisLoading && (
                          <small>
                            {nearestInternationalAirport.distanceKm.toFixed(1)} km away
                          </small>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* SEASONAL DEPENDENCY */}

            <section className="dependency-card">
              <div className="dependency-header">
                <div>
                  <span className="card-label">
                    SEASONAL DEPENDENCY
                  </span>

                  <p>
                    Share of analyzed road
                    access represented by
                    winter roads
                  </p>
                </div>

                {seasonalDependencyLevel && (
                  <span
                    className={`risk-badge ${dependencyClass}`}
                  >
                    {
                      seasonalDependencyLevel
                    }
                  </span>
                )}
              </div>

              <div className="dependency-value-row">
                <strong>
                  {analysisLoading
                    ? "..."
                    : seasonalDependencyPercent !==
                      null
                      ? seasonalDependencyPercent.toFixed(
                        1
                      )
                      : "—"}
                </strong>

                {seasonalDependencyPercent !==
                  null &&
                  !analysisLoading && (
                    <span>%</span>
                  )}
              </div>

              <div className="dependency-track">
                <div
                  className="dependency-fill"
                  style={{
                    width: `${Math.min(
                      seasonalDependencyPercent ??
                      0,
                      100
                    )}%`,
                  }}
                />
              </div>

              <div className="scale-labels">
                <span>LOW</span>
                <span>MODERATE</span>
                <span>HIGH</span>
              </div>
            </section>

            {/* RESILIENCE SCORE */}

            <section className="resilience-card">
              <div className="resilience-card-header">
                <div>
                  <span className="card-label">
                    SEASONAL ACCESS RESILIENCE INDICATOR
                  </span>

                  <p>
                    Prototype indicator based on analyzed
                    road-network composition
                  </p>
                </div>

                {resilienceLevel && (
                  <span
                    className={`risk-badge ${resilienceClass}`}
                  >
                    {resilienceLevel}
                  </span>
                )}
              </div>

              <div className="resilience-score-row">
                <strong>
                  {analysisLoading
                    ? "..."
                    : resilienceScore !== null
                      ? resilienceScore.toFixed(
                        1
                      )
                      : "—"}
                </strong>

                {resilienceScore !== null &&
                  !analysisLoading && (
                    <span>/ 100</span>
                  )}
              </div>

              <div className="resilience-progress">
                <div
                  className="resilience-progress-fill"
                  style={{
                    width: `${Math.min(
                      resilienceScore ?? 0,
                      100
                    )}%`,
                  }}
                />
              </div>

              <div className="backend-badge">
                <span className="backend-dot" />

                Calculated by ASP.NET Core
              </div>

              {backendAnalysis && selectedCommunity && !analysisLoading && (
                <div className="result-summary">
                  <span className="result-summary-label">INTERPRETATION</span>
                  <p>
                    Within <strong>{backendAnalysis.analysisRadiusKm} km</strong>{" "}
                    of <strong>{selectedCommunity}</strong>, winter-road
                    infrastructure represents{" "}
                    <strong>
                      {backendAnalysis.seasonalDependencyPercent.toFixed(1)}%
                    </strong>{" "}
                    of the analyzed road network. The prototype Seasonal Access
                    Resilience Indicator is{" "}
                    <strong>{backendAnalysis.resilienceScore.toFixed(1)}/100</strong>.
                  </p>
                </div>
              )}

              {backendAnalysis && !analysisLoading && (
                <div className="methodology-note">
                  <strong>How is this calculated?</strong>

                  <p>
                    Winter roads represent{" "}
                    <b>
                      {backendAnalysis.seasonalDependencyPercent.toFixed(1)}%
                    </b>{" "}
                    of the{" "}
                    <b>
                      {backendAnalysis.totalAnalyzedRoadKm.toFixed(1)} km
                    </b>{" "}
                    of road infrastructure analyzed within{" "}
                    {backendAnalysis.analysisRadiusKm} km of this community.
                  </p>

                  <div className="formula-box">
                    <span>Prototype resilience indicator</span>
                    <strong>
                      100 − {backendAnalysis.seasonalDependencyPercent.toFixed(1)}%
                      {" = "}
                      {backendAnalysis.resilienceScore.toFixed(1)}
                    </strong>
                  </div>
                </div>
              )}

              <div className="prototype-disclaimer">
                <strong>Prototype methodology</strong>
                <p>
                  This indicator describes road-network composition within the
                  selected analysis radius. It is intended for exploratory
                  analysis and is not an official Government of Alberta
                  resilience assessment.
                </p>
              </div>
            </section>

            {/* ALL-SEASON ACCESS */}

            <section className="primary-kpi">
              <div className="kpi-icon">
                ↔
              </div>

              <div>
                <span className="card-label">
                  ALL-SEASON ACCESS
                </span>

                <strong>
                  {metricValue(
                    allSeasonRoadLength
                  )}
                </strong>

                <p>
                  Paved + gravel road
                  infrastructure within the
                  analysis area
                </p>
              </div>
            </section>

            {/* ACCESS PROFILE */}

            <section className="access-section">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">
                    ACCESS PROFILE
                  </span>

                  <h3>
                    Road infrastructure
                  </h3>
                </div>

                <span className="radius-mini">
                  {analysisRadiusKm} km
                </span>
              </div>

              <div className="road-metrics">
                <div className="road-metric">
                  <div className="metric-top">
                    <span className="road-symbol paved" />

                    <span>Paved</span>
                  </div>

                  <strong>
                    {metricValue(
                      pavedRoadLength
                    )}
                  </strong>
                </div>

                <div className="road-metric">
                  <div className="metric-top">
                    <span className="road-symbol gravel" />

                    <span>Gravel</span>
                  </div>

                  <strong>
                    {metricValue(
                      gravelRoadLength
                    )}
                  </strong>
                </div>

                <div className="road-metric">
                  <div className="metric-top">
                    <span className="road-symbol winter" />

                    <span>Winter</span>
                  </div>

                  <strong>
                    {metricValue(
                      winterRoadLength
                    )}
                  </strong>
                </div>
              </div>
            </section>

            {/* SUPPORTING METRICS */}

            <section className="support-grid">
              <div className="support-card">
                <span>
                  WINTER SEGMENTS
                </span>

                <strong>
                  {analysisLoading
                    ? "..."
                    : winterSegmentCount ??
                    "—"}
                </strong>
              </div>

              <div className="support-card">
                <span>
                  ANALYSIS RADIUS
                </span>

                <strong>
                  {analysisRadiusKm}

                  <small> km</small>
                </strong>
              </div>
            </section>

            {/* MAP CONTROLS */}

            <section className="layers-section">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">
                    MAP CONTROL
                  </span>

                  <h3>Visible layers</h3>
                </div>
              </div>

              <div className="layer-list">
                <label className="layer-control">
                  <div className="layer-name">
                    <span className="road-symbol winter" />

                    <div>
                      <strong>
                        Winter roads
                      </strong>

                      <small>
                        Seasonal access
                      </small>
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={
                      winterRoadsVisible
                    }
                    onChange={(event) => {
                      const visible =
                        event.target.checked;

                      setWinterRoadsVisible(
                        visible
                      );

                      if (
                        winterRoadsRef.current
                      ) {
                        winterRoadsRef.current.visible =
                          visible;
                      }
                    }}
                  />

                  <span className="switch" />
                </label>

                <label className="layer-control">
                  <div className="layer-name">
                    <span className="road-symbol paved" />

                    <div>
                      <strong>
                        Paved roads
                      </strong>

                      <small>
                        All-season access
                      </small>
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={
                      pavedRoadsVisible
                    }
                    onChange={(event) => {
                      const visible =
                        event.target.checked;

                      setPavedRoadsVisible(
                        visible
                      );

                      if (
                        pavedRoadsRef.current
                      ) {
                        pavedRoadsRef.current.visible =
                          visible;
                      }
                    }}
                  />

                  <span className="switch" />
                </label>

                <label className="layer-control">
                  <div className="layer-name">
                    <span className="road-symbol gravel" />

                    <div>
                      <strong>
                        Gravel roads
                      </strong>

                      <small>
                        All-season access
                      </small>
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={
                      gravelRoadsVisible
                    }
                    onChange={(event) => {
                      const visible =
                        event.target.checked;

                      setGravelRoadsVisible(
                        visible
                      );

                      if (
                        gravelRoadsRef.current
                      ) {
                        gravelRoadsRef.current.visible =
                          visible;
                      }
                    }}
                  />

                  <span className="switch" />
                </label>

                <label className="layer-control">
                  <div className="layer-name">
                    <span className="community-dot" />

                    <div>
                      <strong>
                        Communities
                      </strong>

                      <small>
                        Alberta municipal data
                      </small>
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={
                      communitiesVisible
                    }
                    onChange={(event) => {
                      const visible =
                        event.target.checked;

                      setCommunitiesVisible(
                        visible
                      );

                      if (
                        communitiesRef.current
                      ) {
                        communitiesRef.current.visible =
                          visible;
                      }
                    }}
                  />

                  <span className="switch" />
                </label>
              </div>
            </section>

            {analysisError && (
              <div className="error-banner">
                <strong>
                  Analysis unavailable
                </strong>

                <span>
                  {analysisError}
                </span>
              </div>
            )}
          </div>
        </aside>

        {/* ===============================================
            MAP
        =============================================== */}

        <main className="map-workspace">
          <div
            ref={mapDiv}
            className="map-view"
          />

          <div className="map-title-card">
            <span>
              INTERACTIVE ANALYSIS
            </span>

            <strong>
              {selectedCommunity
                ? `${selectedCommunity} Access Area`
                : "Alberta Community Access"}
            </strong>

            <small>
              {selectedCommunity
                ? `${analysisRadiusKm} km geodesic proximity analysis`
                : "Select a community to begin spatial analysis"}
            </small>
          </div>

          <div className="map-legend">
            <div className="legend-header">
              <span>MAP LEGEND</span>
            </div>

            <div className="legend-row">
              <span className="legend-line paved" />
              Paved road
            </div>

            <div className="legend-row">
              <span className="legend-line gravel" />
              Gravel road
            </div>

            <div className="legend-row">
              <span className="legend-line winter" />
              Winter road
            </div>

            <div className="legend-row">
              <span className="community-dot" />
              Community
            </div>

            <div className="legend-row">
              <span className="buffer-symbol" />
              {analysisRadiusKm} km analysis area
            </div>
          </div>

          {analysisLoading && (
            <div className="analysis-overlay">
              <div className="analysis-loader" />

              <div>
                <strong>
                  Analyzing transportation
                  access
                </strong>

                <span>
                  ArcGIS spatial analysis +
                  ASP.NET Core resilience
                  assessment
                </span>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* =================================================
          FOOTER
      ================================================= */}

      <footer className="app-footer">
        <div>
          <span className="footer-source-dot" />

          Government of Alberta Open Data
          <span className="footer-retrieved">
            Retrieved{" "}
            {dataRetrievedAt.toLocaleString("en-CA", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        <div className="footer-stats">
          <span>
            <strong>
              {communityCount ?? "—"}
            </strong>{" "}
            communities
          </span>

          <span className="footer-divider" />

          <span>
            <strong>
              {winterRoadCount ?? "—"}
            </strong>{" "}
            winter-road features
          </span>

          <span className="footer-divider" />

          <span>
            ArcGIS + ASP.NET Core
          </span>
        </div>
      </footer>

      {methodologyOpen && (
        <div
          className="methodology-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMethodologyOpen(false);
          }}
        >
          <section
            className="methodology-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="methodology-title"
          >
            <header className="methodology-modal-header">
              <div>
                <span className="section-kicker">PROJECT METHODOLOGY</span>
                <h2 id="methodology-title">About & Methodology</h2>
              </div>
              <button
                type="button"
                className="methodology-close"
                onClick={() => setMethodologyOpen(false)}
                aria-label="Close methodology"
              >
                ×
              </button>
            </header>

            <div className="methodology-modal-body">
              <h3>About this project</h3>
              <p>
                Alberta Seasonal Access & Supply Resilience is an independent
                geospatial prototype exploring how seasonal transportation
                infrastructure may influence community-level road access across Alberta.
              </p>

              <h3>How the analysis works</h3>
              <p>
                Select an Alberta community and choose a 25, 50, 75, or 100
                kilometre analysis radius. The application creates a geodesic
                buffer around the selected community and analyzes paved,
                gravel, and winter road infrastructure intersecting that area.
              </p>

              <h3>Road-length calculation</h3>
              <p>
                Road geometries intersecting the analysis area are spatially
                clipped to the selected geodesic buffer. Geodetic length is
                calculated for the clipped geometry so only infrastructure
                within the analysis area contributes to the result.
              </p>

              <h3>Seasonal dependency</h3>
              <div className="methodology-equation">
                Seasonal Dependency (%) =
                <br />
                Winter Road km ÷ Total Analyzed Road km × 100
              </div>
              <p>
                This describes the proportion of analyzed road infrastructure
                represented by winter roads.
              </p>

              <h3>Prototype resilience indicator</h3>
              <div className="methodology-equation">
                Seasonal Access Resilience Indicator =
                <br />
                100 − Seasonal Dependency (%)
              </div>
              <p>
                A higher value indicates a lower proportion of winter-road
                infrastructure within the selected analysis area. It should be
                interpreted together with the paved, gravel, and winter-road statistics.
              </p>

              <h3>Data sources</h3>
              <p>
                The application consumes Government of Alberta geospatial
                services for Alberta communities and road infrastructure.
                These services are queried during analysis; the resilience
                indicator itself is not an official government metric.
              </p>

              <h3>Technology</h3>
              <p>
                Spatial visualization and analysis use ArcGIS Maps SDK for
                JavaScript. Road-network measurements are passed to an ASP.NET
                Core API that calculates seasonal dependency and the prototype
                resilience indicator.
              </p>

              <h3>Current limitations</h3>
              <p>
                The prototype evaluates road-network composition within a
                geographic radius. It does not yet evaluate alternative-route
                connectivity, current road closures, weather, freight volumes,
                travel time, critical facilities, supply-chain demand, or the
                operational condition of individual roads.
              </p>

              <div className="methodology-disclaimer">
                <strong>Independent prototype</strong>
                <p>
                  This project is independently developed for exploratory
                  geospatial analysis. It is not affiliated with, endorsed by,
                  or an official assessment of the Government of Alberta.
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;