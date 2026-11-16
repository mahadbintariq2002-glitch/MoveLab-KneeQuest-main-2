plugins {
    id("com.android.application")
}

// "Virtual Therapy" is the web code in the repo root (therapy.html → participant.html / researcher.html → okc.html,
// plus js/ and css/) hosted in a WebView. Nothing is duplicated: syncWeb copies those files into the app at build time.
val webRoot = rootProject.projectDir.parentFile

android {
    namespace = "pk.movelab.kneequest"
    compileSdk = 35

    defaultConfig {
        applicationId = "pk.movelab.virtualtherapy"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "2.0"
        buildConfigField("String", "START_PAGE", "\"therapy.html\"")
        // The public web version (shown on access cards, so patients can also use a browser).
        buildConfigField("String", "PUBLIC_BASE", "\"https://mahadbintariq2002-glitch.github.io/MoveLab-KneeQuest-main-2/\"")
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        release {
            isMinifyEnabled = false   // JavascriptInterface methods must keep their names; the app is tiny anyway
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    sourceSets {
        getByName("main").assets.srcDir(layout.buildDirectory.dir("web"))
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")   // WebViewAssetLoader: serves the bundled files from a real https origin
    implementation("androidx.core:core:1.15.0")       // FileProvider (sharing CSV exports)
}

val syncWeb = tasks.register<Sync>("syncWeb") {
    from(webRoot) {
        include("therapy.html", "participant.html", "researcher.html", "okc.html", "manifest.json", "css/**", "js/**")
    }
    into(layout.buildDirectory.dir("web"))
}
// every task that reads the assets must run after the copy
tasks.configureEach {
    if (name.contains("Assets") || name.contains("Lint") || name.contains("lint")) {
        if (name != "syncWeb") dependsOn(syncWeb)
    }
}
