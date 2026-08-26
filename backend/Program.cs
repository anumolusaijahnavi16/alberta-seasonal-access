using System.Globalization;
using System.Text.Json;
using AlbertaAccess.Api.Models;
using AlbertaAccess.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ========================================================
// SERVICES
// ========================================================

builder.Services.AddScoped<ResilienceService>();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<StatCanPopulationService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy
            .WithOrigins(
                "http://localhost:5173",
                "http://localhost:5174",
                "http://localhost:5175",
                "http://localhost:4173"
            )
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors("Frontend");

// ========================================================
// HEALTH CHECK
// ========================================================

app.MapGet("/api/health", () =>
{
    return Results.Ok(new
    {
        status = "Healthy",
        service = "Alberta Seasonal Access API",
        version = "1.3.0",
        timestampUtc = DateTime.UtcNow
    });
});

// ========================================================
// VERIFIED POPULATION SEED DATA
//
// Keep exact population values separate from the spatial
// municipality lookup. Add only values you have verified
// against the current Government of Alberta population source.
// ========================================================

var population2025 = new Dictionary<string, (int Population, string Geography)>(
    StringComparer.OrdinalIgnoreCase)
{
    ["Cochrane"] = (39397, "Municipality"),
    ["Paradise Valley"] = (205, "Municipality"),
    ["Czar"] = (281, "Municipality"),
    ["Sunchild 202"] = (660, "Indian reserve"),
    ["Greenview No. 16"] = (8984, "Municipal district")
};

// Alberta municipal-boundary service.
// Layers:
// 0 Special Area
// 1 Specialized Municipality
// 2 Improvement District
// 3 Municipal District and County
const string municipalBoundaryBase =
    "https://geospatial.alberta.ca/titan/rest/services/boundaries/municipal_boundary_public/MapServer";

static async Task<string?> FindSurroundingMunicipality(
    HttpClient httpClient,
    double longitude,
    double latitude)
{
    var layers = new[]
    {
        (Id: 3, NameField: "MD_NAME"),
        (Id: 1, NameField: "SPMUN_NAME"),
        (Id: 2, NameField: "IMPDIST_NAME"),
        (Id: 0, NameField: "SPAREA_NAME")
    };

    var point =
        $"{longitude.ToString(CultureInfo.InvariantCulture)}," +
        $"{latitude.ToString(CultureInfo.InvariantCulture)}";

    foreach (var layer in layers)
    {
        var query = new Dictionary<string, string>
        {
            ["f"] = "json",
            ["where"] = "1=1",
            ["geometry"] = point,
            ["geometryType"] = "esriGeometryPoint",
            ["inSR"] = "4326",
            ["spatialRel"] = "esriSpatialRelIntersects",
            ["outFields"] = layer.NameField,
            ["returnGeometry"] = "false"
        };

        var queryString = string.Join(
            "&",
            query.Select(pair =>
                $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"
            )
        );

        var url =
            $"{municipalBoundaryBase}/{layer.Id}/query?{queryString}";

        try
        {
            using var response = await httpClient.GetAsync(url);

            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine(
                    $"Municipality layer {layer.Id} HTTP " +
                    $"{(int)response.StatusCode}: {body}"
                );
                continue;
            }

            using var json = JsonDocument.Parse(body);

            if (json.RootElement.TryGetProperty("error", out var arcGisError))
            {
                Console.WriteLine(
                    $"Municipality layer {layer.Id} ArcGIS error: " +
                    arcGisError.ToString()
                );
                continue;
            }

            if (!json.RootElement.TryGetProperty("features", out var features) ||
                features.ValueKind != JsonValueKind.Array ||
                features.GetArrayLength() == 0)
            {
                continue;
            }

            var attributes = features[0].GetProperty("attributes");

            if (attributes.TryGetProperty(layer.NameField, out var nameValue) &&
                nameValue.ValueKind == JsonValueKind.String)
            {
                var municipalityName = nameValue.GetString()?.Trim();

                if (!string.IsNullOrWhiteSpace(municipalityName))
                {
                    Console.WriteLine(
                        $"Population context: ({latitude}, {longitude}) " +
                        $"is inside {municipalityName}."
                    );

                    return municipalityName;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine(
                $"Municipality lookup failed for layer {layer.Id}: {ex.Message}"
            );
        }
    }

    Console.WriteLine(
        $"No surrounding municipality found for ({latitude}, {longitude})."
    );

    return null;
}

// ========================================================
// POPULATION CONTEXT
// ========================================================

app.MapGet(
    "/api/population/{communityName}",
    async (
        string communityName,
        double? longitude,
        double? latitude,
        IHttpClientFactory httpClientFactory,
        StatCanPopulationService statCanPopulationService
    ) =>
    {
        var normalizedName = Uri.UnescapeDataString(communityName).Trim();

        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            return Results.BadRequest(new
            {
                error = "Community name is required."
            });
        }

        // Exact verified match wins.
        if (population2025.TryGetValue(normalizedName, out var record))
        {
            return Results.Ok(new
            {
                communityName = normalizedName,
                population = (int?)record.Population,
                year = (int?)2025,
                geography = record.Geography,
                parentMunicipality = (string?)null,
                source =
                    "Government of Alberta — Office of Statistics and Information",
                message = (string?)null
            });
        }

        // 2. Try Statistics Canada's complete 2021 Census population
        //    table for an exact Alberta community/designated-place match.
        var censusPopulation =
            await statCanPopulationService.FindAlbertaCommunityAsync(
                normalizedName
            );

        if (censusPopulation is not null)
        {
            return Results.Ok(new
            {
                communityName = normalizedName,
                population = (int?)censusPopulation.Population,
                year = (int?)censusPopulation.Year,
                geography = censusPopulation.Geography,
                parentMunicipality = (string?)null,
                source = censusPopulation.Source,
                message = (string?)null
            });
        }

        // 3. No exact population: use the containing Alberta municipality
        //    only as geographic context, never as the community population.
        string? parentMunicipality = null;

        if (longitude.HasValue && latitude.HasValue)
        {
            var httpClient = httpClientFactory.CreateClient();

            parentMunicipality = await FindSurroundingMunicipality(
                httpClient,
                longitude.Value,
                latitude.Value
            );
        }

        return Results.Ok(new
        {
            communityName = normalizedName,
            population = (int?)null,
            year = (int?)null,
            geography = (string?)null,
            parentMunicipality,
            source = "Government of Alberta",
            message = parentMunicipality is null
                ? "Current community-level estimate unavailable"
                : "Exact community-level estimate unavailable"
        });
    }
);

// ========================================================
// ACCESS & RESILIENCE ANALYSIS
// ========================================================

app.MapPost(
    "/api/access/analyze",
    (
        AccessAnalysisRequest request,
        ResilienceService resilienceService
    ) =>
    {
        if (string.IsNullOrWhiteSpace(request.CommunityName))
        {
            return Results.BadRequest(new
            {
                error = "Community name is required."
            });
        }

        if (
            request.PavedRoadKm < 0 ||
            request.GravelRoadKm < 0 ||
            request.WinterRoadKm < 0
        )
        {
            return Results.BadRequest(new
            {
                error = "Road lengths cannot be negative."
            });
        }

        if (request.WinterSegmentCount < 0)
        {
            return Results.BadRequest(new
            {
                error = "Winter segment count cannot be negative."
            });
        }

        if (request.AnalysisRadiusKm <= 0)
        {
            return Results.BadRequest(new
            {
                error = "Analysis radius must be greater than zero."
            });
        }

        var result = resilienceService.Analyze(request);

        return Results.Ok(result);
    }
);

app.Run();
