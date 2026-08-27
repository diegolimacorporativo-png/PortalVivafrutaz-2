package com.vivafrutaz.tracker.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RoomDatabase

@Entity(
    tableName = "pending_gps",
    indices = [Index(value = ["payloadHash"], unique = true)],
)
data class PendingGpsEntity(
    @androidx.room.PrimaryKey(autoGenerate = true) val id: Long = 0,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double?,
    val speed: Double?,
    val heading: Double?,
    val capturedAt: Long,
    val payloadHash: String,
)

@Dao
interface PendingGpsDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(position: PendingGpsEntity): Long

    @Query("SELECT * FROM pending_gps ORDER BY capturedAt ASC LIMIT :limit")
    suspend fun oldest(limit: Int): List<PendingGpsEntity>

    @Query("DELETE FROM pending_gps WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM pending_gps WHERE id NOT IN (SELECT id FROM pending_gps ORDER BY capturedAt DESC LIMIT :limit)")
    suspend fun trimToLimit(limit: Int)

    @Query("SELECT COUNT(*) FROM pending_gps")
    suspend fun count(): Int
}

@Database(entities = [PendingGpsEntity::class], version = 1, exportSchema = false)
abstract class GpsDatabase : RoomDatabase() {
    abstract fun pendingGpsDao(): PendingGpsDao

    companion object {
        @Volatile
        private var instance: GpsDatabase? = null

        fun get(context: android.content.Context): GpsDatabase =
            instance ?: synchronized(this) {
                instance ?: androidx.room.Room.databaseBuilder(
                    context.applicationContext,
                    GpsDatabase::class.java,
                    "vivafrutaz_tracker.db",
                ).build().also { instance = it }
            }
    }
}