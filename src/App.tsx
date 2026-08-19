/**
 * Alberta Seasonal Access & Essential Supply Resilience Analyzer
 * Author: Sai Jahnavi Anumolu
 * Personal GIS Project — August 2026
 */

import { useEffect, useRef, useState } from "react";

import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
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

const ANALYSIS_RADIUS_KM = 50;

const API_BASE_URL = "http://localhost:5112";

const ALBERTA_ACCESS_SERVICE =
  "https://geospatial.alberta.ca/titan/rest/services/utility/access/MapServer";

const WINTER_ROADS_URL = `${ALBERTA_ACCESS_SERVICE}/26`;
const PAVED_ROADS_URL = `${ALBERTA_ACCESS_SERVICE}/14`;
const GRAVEL_ROADS_URL = `${ALBERTA_ACCESS_SERVICE}/23`;

// ========================================================
// ASP.NET CORE API TYPES
// ========================================================

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

  const winterRoadsRef = useRef<FeatureLayer | null>(null);
  const pavedRoadsRef = useRef<FeatureLayer | null>(null);
  const gravelRoadsRef = useRef<FeatureLayer | null>(null);
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

  const [backendAnalysis, setBackendAnalysis] =
    useState<AccessAnalysisResponse | null>(null);

  const [analysisLoading, setAnalysisLoading] =
    useState(false);

  const [analysisError, setAnalysisError] = useState<
    string | null
  >(null);

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

            analysisRadiusKm: ANALYSIS_RADIUS_KM,
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

    // ====================================================
    // COMMUNITY CLICK ANALYSIS
    // ====================================================

    const clickHandle = view.on(
      "click",
      async (event) => {
        try {
          const response = await view.hitTest(event, {
            include: [communities],
          });

          const communityResult =
            response.results.find(
              (result) =>
                result.type === "graphic"
            );

          if (
            !communityResult ||
            communityResult.type !== "graphic"
          ) {
            return;
          }

          const communityGraphic =
            communityResult.graphic;

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
          // CREATE 50 KM BUFFER
          // ----------------------------------------------

          const bufferGeometry =
            geodesicBufferOperator.execute(
              selectedGeometry,
              ANALYSIS_RADIUS_KM,
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

          const [
            winterAnalysis,
            pavedAnalysis,
            gravelAnalysis,
          ] = await Promise.all([
            calculateClippedRoadLength(
              winterRoads,
              bufferGeometry
            ),

            calculateClippedRoadLength(
              pavedRoads,
              bufferGeometry
            ),

            calculateClippedRoadLength(
              gravelRoads,
              bufferGeometry
            ),
          ]);

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

      view.destroy();

      winterRoadsRef.current = null;

      pavedRoadsRef.current = null;

      gravelRoadsRef.current = null;

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

            LIVE GOVERNMENT DATA
          </div>

          <div className="radius-pill">
            <span>◎</span>

            {ANALYSIS_RADIUS_KM} KM ANALYSIS
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
                    RESILIENCE SCORE
                  </span>

                  <p>
                    Backend resilience
                    assessment
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
                  {ANALYSIS_RADIUS_KM} km
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
                  {ANALYSIS_RADIUS_KM}

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
                ? `${ANALYSIS_RADIUS_KM} km geodesic proximity analysis`
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
              50 km analysis area
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
    </div>
  );
}

export default App;