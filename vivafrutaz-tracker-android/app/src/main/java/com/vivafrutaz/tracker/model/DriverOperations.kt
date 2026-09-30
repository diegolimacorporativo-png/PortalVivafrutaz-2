package com.vivafrutaz.tracker.model

data class DriverRoute(
    val date: String,
    val deliveries: List<DriverDelivery>,
    val driverName: String?,
)

data class DriverDelivery(
    val id: Long,
    val companyName: String,
    val address: String,
    val city: String,
    val status: String,
    val routePosition: Int?,
    val deliveryWindow: String?,
    val notes: String?,
    val latitude: Double?,
    val longitude: Double?,
)

data class DeliveryChecklist(
    val id: Long?,
    val confirmed: Boolean,
    val observation: String?,
    val signatureUrl: String?,
    val photoUrl: String?,
)

data class StopStatusResult(val status: String, val registeredAt: String?)
