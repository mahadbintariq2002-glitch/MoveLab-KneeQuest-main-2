plugins {
    id("com.android.application")
}

// The apps are the web code in the repo root (okc.html, participant.html, researcher.html, js/, css/) hosted in a
// WebView. Nothing is duplicated: the Sync tasks below copy those files into each flavor's assets at build time.
val webRoot = rootProject.projectDir.parentFile

android {
    namespace = "pk.movelab.kneequest"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        // Where participants sign in on the web (shown on access cards). The live GitHub Pages site.
        buildConfigField("String", "PUBLIC_BASE", "\"https://mahadbintariq2002-glitch.github.io/MoveLab-KneeQuest-main-2/\"")
    }

    buildFeatures { buildConfig = true }

    flavorDimensions += "role"
    productFlavors {
        create("patient") {
            dimension = "role"
            applicationId = "pk.movelab.kneequest.patient"
            buildConfigField("String", "ROLE", "\"patient\"")
            buildConfigField("String", "START_PAGE", "\"participant.html\"")
        }
        create("researcher") {
            dimension = "role"
            applicationId = "pk.movelab.kneequest.researcher"
            buildConfigField("String", "ROLE", "\"researcher\"")
            buildConfigField("String", "START_PAGE", "\"researcher.html\"")
        }
    }

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
        getByName("patient").assets.srcDir(layout.buildDirectory.dir("web/patient"))
        getByName("researcher").assets.srcDir(layout.buildDirectory.dir("web/researcher"))
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")   // WebViewAssetLoader: serves the bundled files from a real https origin
    implementation("androidx.core:core:1.15.0")       // FileProvider (sharing CSV exports)
}

listOf("patient", "researcher").forEach { flavor ->
    val cap = flavor.replaceFirstChar { it.uppercase() }
    val sync = tasks.register<Sync>("syncWeb$cap") {
        from(webRoot) {
            include("okc.html", "participant.html", "researcher.html", "manifest.json", "css/**", "js/**")
            if (flavor == "patient") exclude("researcher.html", "js/study/researcher.js", "js/study/charts.js")
        }
        into(layout.buildDirectory.dir("web/$flavor"))
    }
    // every task that reads this flavor's assets must run after the copy
    tasks.configureEach {
        if (name.contains(cap) && (name.contains("Assets") || name.contains("Lint") || name.contains("lint"))) {
            dependsOn(sync)
        }
    }
}
