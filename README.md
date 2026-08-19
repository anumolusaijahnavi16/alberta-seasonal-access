# Alberta Seasonal Access & Supply Resilience Analyzer

A full-stack geospatial decision-support application that analyzes seasonal transportation accessibility for Alberta communities using live Government of Alberta GIS data.

The application combines **React, TypeScript, ArcGIS Maps SDK for JavaScript, ASP.NET Core, and C#** to perform interactive 50 km proximity analysis and calculate community-level seasonal dependency and transportation resilience metrics.

---

## Overview

Remote and northern communities can depend on seasonal road infrastructure for transportation and supply access.

This application allows a user to select an Alberta community and automatically analyzes road infrastructure within a **50 km geodesic radius**.

The system calculates:

- Paved road length
- Gravel road length
- Winter road length
- Number of winter-road segments
- Total all-season road access
- Seasonal dependency percentage
- Community resilience score
- Resilience classification

The result is presented through an interactive GIS dashboard designed to support transportation-access and infrastructure analysis.

---

## Key Features

### Interactive GIS Analysis

- Interactive ArcGIS map of Alberta
- Community selection directly from the map
- Address/place search
- 50 km geodesic community analysis area
- Dynamic map navigation
- Interactive community visualization

### Government GIS Data

The application consumes Government of Alberta geospatial services for:

- Alberta communities
- Winter roads
- Paved roads
- Gravel roads

Spatial features are queried dynamically rather than stored as hard-coded project data.

### Spatial Road Analysis

For each selected community, the application:

1. Creates a 50 km geodesic analysis area.
2. Queries road features intersecting the analysis area.
3. Calculates road lengths within the analysis area.
4. Separates infrastructure into paved, gravel, and winter-road categories.
5. Calculates community seasonal dependency metrics.

### ASP.NET Core Resilience API

The frontend sends the GIS-derived metrics to an **ASP.NET Core REST API**.

The C# backend:

- Validates the analysis request
- Calculates total all-season road access
- Calculates total analyzed road infrastructure
- Calculates seasonal dependency
- Generates a resilience score
- Classifies dependency and resilience levels

### Interactive Dashboard

The dashboard displays:

- Seasonal Dependency
- Resilience Score
- All-Season Access
- Paved Road Length
- Gravel Road Length
- Winter Road Length
- Winter Road Segment Count
- Analysis Radius
- Interactive Layer Controls
- Map Legend

---

## Architecture

```text
Government of Alberta GIS Services
                |
                v
      ArcGIS Feature Layers
                |
                v
   React + TypeScript Frontend
                |
                | Spatial queries
                | Geodesic analysis
                | Road-length calculations
                v
       Community Access Metrics
                |
                | HTTP POST /api/access/analyze
                v
       ASP.NET Core REST API
                |
                v
        C# Resilience Service
                |
                v
 Dependency + Resilience Metrics
                |
                v
       Interactive GIS Dashboard
```

---

## Technology Stack

### Frontend

- React
- TypeScript
- Vite
- HTML5
- CSS3

### GIS

- ArcGIS Maps SDK for JavaScript
- ArcGIS FeatureLayer
- ArcGIS Geometry Operators
- Geodesic spatial analysis
- Government of Alberta Open Data

### Backend

- C#
- ASP.NET Core
- REST API
- Dependency Injection
- Request Validation

### Development

- Git
- GitHub
- npm
- .NET SDK

---

## Example Analysis

### Chateh, Alberta

Using a 50 km analysis radius:

| Metric | Result |
|---|---:|
| Paved Roads | 102.2 km |
| Gravel Roads | 546.0 km |
| Winter Roads | 172.1 km |
| Winter Road Segments | 67 |
| All-Season Access | 648.2 km |
| Seasonal Dependency | 21.0% |
| Resilience Score | 79 / 100 |
| Dependency Level | Moderate |
| Resilience Level | Moderate |

The results are dynamically calculated from the selected community and surrounding road infrastructure.

---

## Resilience Calculation

Seasonal dependency represents the proportion of analyzed road access associated with winter-road infrastructure.

```text
All-Season Access =
Paved Road Length + Gravel Road Length

Total Analyzed Road Access =
All-Season Access + Winter Road Length

Seasonal Dependency (%) =
Winter Road Length / Total Analyzed Road Access × 100
```

The backend converts this analysis into a resilience score:

```text
Resilience Score =
100 - Seasonal Dependency
```

The result provides an interpretable indicator of how strongly the analyzed road network depends on seasonal infrastructure.

---

## API

### Health Check

```http
GET /api/health
```

Example response:

```json
{
  "status": "Healthy",
  "service": "Alberta Seasonal Access API",
  "version": "1.0.0"
}
```

### Analyze Community Access

```http
POST /api/access/analyze
```

Example request:

```json
{
  "communityName": "Chateh",
  "communityType": "Locality",
  "pavedRoadKm": 102.2,
  "gravelRoadKm": 546.0,
  "winterRoadKm": 172.1,
  "winterSegmentCount": 67,
  "analysisRadiusKm": 50
}
```

Example response:

```json
{
  "communityName": "Chateh",
  "communityType": "Locality",
  "pavedRoadKm": 102.2,
  "gravelRoadKm": 546.0,
  "winterRoadKm": 172.1,
  "allSeasonRoadKm": 648.2,
  "totalAnalyzedRoadKm": 820.3,
  "winterSegmentCount": 67,
  "analysisRadiusKm": 50,
  "seasonalDependencyPercent": 21,
  "dependencyLevel": "Moderate",
  "resilienceScore": 79,
  "resilienceLevel": "Moderate"
}
```

---

## Running the Project Locally

### Prerequisites

Install:

- Node.js
- npm
- .NET SDK

### Clone the Repository

```bash
git clone <repository-url>
cd alberta-seasonal-access
```

### Install Frontend Dependencies

```bash
npm install
```

### Start the React Frontend

```bash
npm run dev
```

The frontend will normally run at:

```text
http://localhost:5173
```

### Start the ASP.NET Core Backend

Open another terminal:

```bash
cd backend
dotnet run
```

The API runs locally at:

```text
http://localhost:5112
```

### Verify the API

```bash
curl http://localhost:5112/api/health
```

---

## Project Structure

```text
alberta-seasonal-access/
│
├── backend/
│   ├── Models/
│   │   └── AccessAnalysis.cs
│   ├── Services/
│   │   └── ResilienceService.cs
│   ├── Program.cs
│   └── AlbertaAccess.Api.csproj
│
├── public/
│
├── src/
│   ├── App.tsx
│   ├── App.css
│   ├── index.css
│   └── main.tsx
│
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## Engineering Highlights

This project demonstrates:

- Full-stack application development with React and ASP.NET Core
- Type-safe frontend development with TypeScript
- C# REST API development
- Integration of frontend GIS analysis with backend business logic
- Real-time querying of external geospatial services
- Geodesic proximity analysis
- Spatial feature filtering and measurement
- Interactive map-layer management
- Responsive dashboard UI development
- API request validation
- Separation of frontend visualization and backend analytical logic

---

## Data Source

Geospatial information used by the application is sourced from publicly available **Government of Alberta Open Data / GIS services**.

The application is an independent portfolio and decision-support prototype and is not an official Government of Alberta application.

---

## Future Enhancements

Potential future improvements include:

- Configurable analysis radius
- Supply-route criticality scoring
- Emergency-access analysis
- Community comparison
- Historical seasonal-access trends
- Database persistence
- Automated API testing
- Cloud deployment
- Authentication and role-based access
- Infrastructure risk visualization

---

## Purpose

This project was developed to explore how modern full-stack development and GIS technology can transform public geospatial datasets into practical decision-support tools.

Rather than simply displaying road infrastructure on a map, the application converts spatial data into measurable indicators of **seasonal accessibility and transportation resilience**.