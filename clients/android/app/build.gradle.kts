plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.triforce.remote"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.triforce.remote"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures { buildConfig = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

val sharedAssets = layout.buildDirectory.dir("generated/shared-assets")
val buildSharedClient by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir.resolve("../.."))
    commandLine("npm", "run", "build", "--workspace", "@triforce/client")
}
val syncSharedClient by tasks.registering(Sync::class) {
    dependsOn(buildSharedClient)
    from(rootProject.projectDir.resolve("../shared/dist"))
    into(sharedAssets.map { it.dir("www") })
}
android.sourceSets.getByName("main").assets.srcDir(sharedAssets)
tasks.named("preBuild").configure { dependsOn(syncSharedClient) }

dependencies {
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16.1")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core-ktx:1.7.0")
}
