using AlbertaAccess.Api.Models;
using AlbertaAccess.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ========================================================
// SERVICES
// ========================================================

builder.Services.AddScoped<ResilienceService>();

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

// ========================================================
// MIDDLEWARE
// ========================================================

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
        version = "1.0.0",
        timestampUtc = DateTime.UtcNow
    });
});

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