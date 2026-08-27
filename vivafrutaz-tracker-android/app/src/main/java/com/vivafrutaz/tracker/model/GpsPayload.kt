package com.vivafrutaz.tracker.model

data class GpsPayload(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double?,
    val speed: Double?,
    val heading: Double?,
    val capturedAt: Long,
)

data class DriverSession(
    val userId: Long,
    val name: String,
    val role: String,
)