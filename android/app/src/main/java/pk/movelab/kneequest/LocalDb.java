package pk.movelab.kneequest;

import android.content.ContentValues;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** The phone's own copy of every finished session (the full JSON record, keyed by its id; a retry just overwrites). */
class LocalDb extends SQLiteOpenHelper {
    LocalDb(Context c) {
        super(c, "movelab.db", null, 1);
    }

    @Override
    public void onCreate(SQLiteDatabase d) {
        d.execSQL("CREATE TABLE sessions (id TEXT PRIMARY KEY, study_id TEXT, json TEXT NOT NULL, saved_at INTEGER NOT NULL)");
        d.execSQL("CREATE INDEX sessions_study ON sessions(study_id)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase d, int from, int to) {
        // v1 only
    }

    void put(String id, String studyId, String json) {
        ContentValues v = new ContentValues();
        v.put("id", id);
        v.put("study_id", studyId);
        v.put("json", json);
        v.put("saved_at", System.currentTimeMillis());
        getWritableDatabase().insertWithOnConflict("sessions", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }
}
