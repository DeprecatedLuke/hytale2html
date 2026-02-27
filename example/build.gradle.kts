import org.gradle.api.GradleException
import org.gradle.api.tasks.Delete
import org.gradle.api.tasks.Exec
import org.gradle.api.tasks.PathSensitivity

plugins {
    java
}

// Path to the html2hytale repository (adjust for your workspace layout)
val html2hytaleDir = file("../html2hytale")

// HTML+Tailwind source used by html2hytale
val uiSourceDir = file("ui-source")

// Standard Gradle resources root for a Hytale Java mod/plugin
val resourcesDir = file("src/main/resources")

// Hytale UI namespace under Common/UI/Custom/<namespace>
val uiNamespace = "MyMod"

// Render viewport used by html2hytale
val viewportSize = "1920x1080"

// Pass -PuiForce=true to regenerate all pages
val forceUiGeneration = providers.gradleProperty("uiForce").orNull == "true"

val generateUI by tasks.registering(Exec::class) {
    group = "build"
    description = "Generate Hytale .ui files and PNG textures from HTML source"

    val outUiDir = resourcesDir.resolve("Common/UI/Custom/$uiNamespace")
    val outHtmlDir = layout.buildDirectory.dir("ui-preview")

    workingDir = html2hytaleDir

    val command = mutableListOf(
        "bun", "run", "src/index.ts",
        "--input", uiSourceDir.absolutePath,
        "--out-resources", resourcesDir.absolutePath,
        "--out-ui", outUiDir.absolutePath,
        "--out-html", outHtmlDir.get().asFile.absolutePath,
        "--namespace", uiNamespace,
        "--viewport", viewportSize,
    )

    if (forceUiGeneration) {
        command += "--force"
    } else {
        command += "--check"
    }

    commandLine(command)

    inputs.dir(uiSourceDir)
        .withPropertyName("uiSource")
        .withPathSensitivity(PathSensitivity.RELATIVE)

    inputs.file(uiSourceDir.resolve("tailwind.config.js"))
        .withPropertyName("tailwindConfig")
        .withPathSensitivity(PathSensitivity.RELATIVE)

    inputs.file(html2hytaleDir.resolve("src/index.ts"))
        .withPropertyName("html2hytaleEntrypoint")
        .withPathSensitivity(PathSensitivity.RELATIVE)

    outputs.dir(outUiDir)
        .withPropertyName("uiAssets")

    outputs.dir(outHtmlDir)
        .withPropertyName("uiPreviewHtml")

    doFirst {
        if (!html2hytaleDir.exists()) {
            throw GradleException("html2hytale directory not found: ${html2hytaleDir.absolutePath}")
        }
        if (!uiSourceDir.exists()) {
            throw GradleException("UI source directory not found: ${uiSourceDir.absolutePath}")
        }

        val hasPages = uiSourceDir.resolve("pages").exists()
        val hasStaticPages = uiSourceDir.resolve("static-pages").exists()
        if (!hasPages && !hasStaticPages) {
            throw GradleException("No pages/ or static-pages/ directory found in ${uiSourceDir.absolutePath}")
        }

        val tailwindConfig = uiSourceDir.resolve("tailwind.config.js")
        if (!tailwindConfig.exists()) {
            throw GradleException("Missing tailwind.config.js in ${uiSourceDir.absolutePath}")
        }
    }
}

tasks.named("processResources") {
    dependsOn(generateUI)
}

tasks.named<Delete>("clean") {
    delete(resourcesDir.resolve("Common/UI/Custom/$uiNamespace"))
    delete(layout.buildDirectory.dir("ui-preview"))
}
