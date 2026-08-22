plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android { namespace = "com.airferrylite.receiver"; compileSdk = 35
    defaultConfig {
        applicationId = "com.airferrylite.receiver"
        minSdk = 29
        targetSdk = 35
        versionCode = 85
        versionName = "0.8.70"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }
    buildTypes { release { isMinifyEnabled = false; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("io.github.zxing-cpp:android:2.3.0")
    testImplementation("junit:junit:4.13.2")
}
