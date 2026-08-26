# Alberta Seasonal Access & Supply Resilience

A GIS decision-support application for exploring transportation access and seasonal road dependency across Alberta communities.

## What It Does

Select an Alberta community and choose an analysis radius:

- 25 km
- 50 km
- 75 km
- 100 km

The application analyzes nearby transportation infrastructure and provides a simple community access profile.

### Community Profile

The dashboard displays:

- Population context
- Paved road distance
- Gravel road distance
- Winter road distance
- Seasonal dependency
- Public airport access
- Regional airport access
- International airport access

## Application Flow

```text
Select Community
       |
       v
Choose Analysis Radius
25 / 50 / 75 / 100 km
       |
       v
Create Geodesic Analysis Area
       |
       v
Analyze Nearby Road Infrastructure
       |
       +---- Paved Roads
       +---- Gravel Roads
       +---- Winter Roads
       |
       v
ASP.NET Core API
       |
       +---- Access Analysis
       +---- Population Context
       +---- Airport Access
       |
       v
Calculate Seasonal Dependency
       |
       v
Display Community Access Profile
```

## Architecture

```text
Government of Alberta / Statistics Canada
                    |
                    v
            GIS & Population Data
                    |
                    v
        React + TypeScript Frontend
                    |
                    v
            ASP.NET Core API
                    |
                    v
        Transportation Analysis
                    |
                    v
              GIS Dashboard
```

## Technology

**Frontend**
- React
- TypeScript
- Vite
- ArcGIS Maps SDK for JavaScript

**Backend**
- C#
- ASP.NET Core
- REST API

**Data**
- Government of Alberta Open Data
- ArcGIS Feature Services
- Statistics Canada

**Deployment**
- Docker
- Nginx
- TrueNAS

## Production Flow

```text
Browser
   |
   v
Frontend / Nginx
   |
   | /api/*
   v
ASP.NET Core Backend
   |
   +---- Access Analysis
   +---- Population
   +---- Airport Context
```

The production frontend uses relative `/api/...` requests. Nginx forwards those requests to the backend Docker container.

## Purpose

The project provides a quick visual way to understand how Alberta communities depend on surrounding transportation infrastructure and how seasonal road access may affect overall connectivity and resilience.